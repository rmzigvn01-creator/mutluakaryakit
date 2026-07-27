import fs from "fs";
import os from "os";
import path from "path";
import { SuspicionStatus, TransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  extractFromReceipt,
  evaluateSuspicion,
  resolveReceiptDateTime,
  isSuspiciousStatus,
} from "./ocr.service.js";
import { notifyAdminsSuspiciousTransaction } from "./push.service.js";

const OCR_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

async function resolveOcrFilePath(tx: {
  id: string;
  receiptPath: string | null;
  receiptData: Buffer | Uint8Array | null;
  receiptMime: string | null;
}): Promise<{ filePath: string; cleanup?: string }> {
  if (tx.receiptPath && fs.existsSync(tx.receiptPath)) {
    return { filePath: tx.receiptPath };
  }
  if (tx.receiptData && tx.receiptData.length > 0) {
    const ext =
      tx.receiptMime === "image/png"
        ? ".png"
        : tx.receiptMime === "image/webp"
          ? ".webp"
          : ".jpg";
    const tmp = path.join(os.tmpdir(), `ocr-${tx.id}${ext}`);
    fs.writeFileSync(tmp, Buffer.from(tx.receiptData));
    return { filePath: tmp, cleanup: tmp };
  }
  throw new Error("Fiş dosyası yok (path + blob boş)");
}

export async function processTransactionOcr(transactionId: string): Promise<SuspicionStatus> {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      enteredAmount: true,
      createdAt: true,
      stationId: true,
      type: true,
      receiptPath: true,
      receiptData: true,
      receiptMime: true,
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!tx) throw new Error("İşlem bulunamadı");

  let cleanup: string | undefined;
  try {
    const resolved = await resolveOcrFilePath(tx);
    cleanup = resolved.cleanup;

    const extracted = await withTimeout(
      extractFromReceipt(resolved.filePath, path.basename(resolved.filePath)),
      OCR_TIMEOUT_MS,
      "OCR"
    );

    const receiptDateTime = resolveReceiptDateTime(
      extracted.text,
      tx.createdAt,
      extracted.dateTime
    );
    const { status, diff } = evaluateSuspicion(
      tx.enteredAmount,
      extracted.amount,
      tx.createdAt,
      receiptDateTime
    );

    const updated = await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        receiptAmount: extracted.amount,
        receiptDateTime,
        amountDiff: diff,
        suspicionStatus: status,
        suspicionNote: extracted.receiptNo
          ? `OCR fiş no: ${extracted.receiptNo}`
          : null,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    if (isSuspiciousStatus(status)) {
      void notifyAdminsSuspiciousTransaction({
        id: updated.id,
        stationId: tx.stationId,
        type: tx.type as TransactionType,
        enteredAmount: updated.enteredAmount,
        receiptAmount: updated.receiptAmount,
        amountDiff: updated.amountDiff,
        suspicionStatus: updated.suspicionStatus,
        createdBy: updated.createdBy,
      });
    }

    return status;
  } catch (err) {
    console.warn(`OCR başarısız (${transactionId.slice(0, 8)}):`, err);
    await prisma.transaction.update({
      where: { id: transactionId },
      data: { suspicionStatus: SuspicionStatus.SUSPICIOUS_UNREADABLE },
    });
    return SuspicionStatus.SUSPICIOUS_UNREADABLE;
  } finally {
    if (cleanup) {
      try {
        fs.unlinkSync(cleanup);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Deploy/restart sonrası takılı PENDING_OCR kayıtlarını tamamla */
export async function reprocessPendingOcr(limit = 15): Promise<number> {
  const pending = await prisma.transaction.findMany({
    where: {
      isDeleted: false,
      suspicionStatus: SuspicionStatus.PENDING_OCR,
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  if (!pending.length) return 0;
  console.log(`[ocr] PENDING_OCR yeniden işleniyor: ${pending.length}`);

  let done = 0;
  for (const row of pending) {
    try {
      const status = await processTransactionOcr(row.id);
      console.log(`[ocr] ${row.id.slice(0, 8)} → ${status}`);
      done += 1;
    } catch (e) {
      console.warn(`[ocr] ${row.id.slice(0, 8)} hata:`, e);
    }
  }
  return done;
}

export function startPendingOcrRecovery(): void {
  // İlk açılışta biraz bekle (deploy stabilize)
  setTimeout(() => {
    void reprocessPendingOcr();
  }, 8_000);

  // Her 3 dk takılı kalanları tara
  setInterval(() => {
    void reprocessPendingOcr();
  }, 3 * 60 * 1000);
}

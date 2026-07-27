import { ShiftStatus, SuspicionStatus, TransactionType, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export const TYPE_LABELS: Record<TransactionType, string> = {
  FUEL_BENZIN: "Benzin",
  FUEL_MOTORIN: "Motorin",
  CARD_POS: "Kart (POS)",
  CASH: "Nakit",
  OTHER: "Diğer",
};

const FUEL_TYPES: TransactionType[] = [TransactionType.FUEL_BENZIN, TransactionType.FUEL_MOTORIN];

export function getTurkeyDayBounds(dateStr: string): { from: Date; to: Date } {
  return {
    from: new Date(`${dateStr}T00:00:00+03:00`),
    to: new Date(`${dateStr}T23:59:59.999+03:00`),
  };
}

export function todayTurkeyDateStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
}

import { isSuspiciousStatus } from "../services/ocr.service.js";

function isSuspicious(status: SuspicionStatus): boolean {
  return isSuspiciousStatus(status);
}

function sumByTypes(
  transactions: { type: TransactionType; enteredAmount: number }[],
  types: TransactionType[]
): number {
  return transactions
    .filter((t) => types.includes(t.type))
    .reduce((s, t) => s + t.enteredAmount, 0);
}

function buildByType(transactions: { type: TransactionType; enteredAmount: number }[]) {
  const byType: Record<string, { count: number; total: number }> = {};
  for (const t of transactions) {
    if (!byType[t.type]) byType[t.type] = { count: 0, total: 0 };
    byType[t.type].count++;
    byType[t.type].total += t.enteredAmount;
  }
  return byType;
}

export async function buildDayCloseReport(
  stationId: string,
  dateStr: string,
  role: UserRole
) {
  const { from, to } = getTurkeyDayBounds(dateStr);
  const isAdmin = role === UserRole.ADMIN;

  const [station, transactions, dayShifts, openShifts, staffUsers] = await Promise.all([
    prisma.station.findUnique({ where: { id: stationId }, select: { name: true } }),
    prisma.transaction.findMany({
      where: {
        stationId,
        isDeleted: false,
        createdAt: { gte: from, lte: to },
      },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.shift.findMany({
      where: {
        stationId,
        OR: [
          { startedAt: { gte: from, lte: to } },
          { endedAt: { gte: from, lte: to } },
          { status: ShiftStatus.OPEN, startedAt: { lte: to } },
        ],
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { startedAt: "asc" },
    }),
    prisma.shift.findMany({
      where: {
        stationId,
        status: ShiftStatus.OPEN,
        startedAt: { lte: to },
      },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.user.findMany({
      where: { stationId, role: UserRole.STAFF },
      select: { id: true, name: true },
    }),
  ]);

  const totalAmount = transactions.reduce((s, t) => s + t.enteredAmount, 0);
  const suspiciousCount = isAdmin
    ? transactions.filter((t) => isSuspicious(t.suspicionStatus)).length
    : 0;

  const byType = buildByType(transactions);

  const staff = staffUsers.map((user) => {
    const userTx = transactions.filter((t) => t.createdById === user.id);
    const userSuspicious = isAdmin
      ? userTx.filter((t) => isSuspicious(t.suspicionStatus)).length
      : 0;

    return {
      id: user.id,
      name: user.name,
      transactionCount: userTx.length,
      totalAmount: userTx.reduce((s, t) => s + t.enteredAmount, 0),
      suspiciousCount: userSuspicious,
      byType: buildByType(userTx),
    };
  });

  staff.sort((a, b) => b.totalAmount - a.totalAmount);

  const activeStaff = staff.filter((s) => s.transactionCount > 0);

  const warnings: string[] = [];

  if (dateStr === todayTurkeyDateStr() && openShifts.length > 0) {
    const names = openShifts.map((s) => s.user.name).join(", ");
    warnings.push(`${openShifts.length} açık vardiya var (${names}) — kapatmanız önerilir`);
  }

  if (isAdmin && suspiciousCount > 0) {
    warnings.push(`${suspiciousCount} şüpheli işlem var — inceleme önerilir`);
  }

  if (transactions.length === 0) {
    warnings.push("Bu tarihte işlem kaydı bulunamadı");
  }

  const closedShiftsToday = dayShifts.filter((s) => s.status === ShiftStatus.CLOSED);

  return {
    date: dateStr,
    stationName: station?.name ?? "İstasyon",
    period: { from, to },
    summary: {
      transactionCount: transactions.length,
      totalAmount,
      suspiciousCount,
      averageAmount: transactions.length > 0 ? totalAmount / transactions.length : 0,
      cashTotal: sumByTypes(transactions, [TransactionType.CASH]),
      cardTotal: sumByTypes(transactions, [TransactionType.CARD_POS]),
      fuelTotal: sumByTypes(transactions, FUEL_TYPES),
      otherTotal: sumByTypes(transactions, [TransactionType.OTHER]),
      byType,
    },
    staff: activeStaff,
    shifts: {
      total: dayShifts.length,
      closed: closedShiftsToday.length,
      open: openShifts.length,
      items: dayShifts.map((s) => ({
        id: s.id,
        staffName: s.user.name,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        closingNote: s.closingNote,
      })),
    },
    warnings,
    generatedAt: new Date(),
  };
}

export function formatDayCloseCsv(
  report: Awaited<ReturnType<typeof buildDayCloseReport>>,
  role: UserRole,
  transactions: {
    createdAt: Date;
    type: TransactionType;
    enteredAmount: number;
    description: string | null;
    suspicionStatus: SuspicionStatus;
    createdBy: { name: string };
  }[]
): string {
  const isAdmin = role === UserRole.ADMIN;
  const lines: string[] = [];

  lines.push("Mutlu Akaryakit - Gun Sonu Raporu");
  lines.push(`Istasyon,${report.stationName}`);
  lines.push(`Tarih,${report.date}`);
  lines.push(`Olusturma,${new Date(report.generatedAt).toLocaleString("tr-TR")}`);
  lines.push("");

  lines.push("OZET");
  lines.push(`Toplam Islem,${report.summary.transactionCount}`);
  lines.push(`Toplam Tutar (TL),${report.summary.totalAmount.toFixed(2)}`);
  lines.push(`Nakit (TL),${report.summary.cashTotal.toFixed(2)}`);
  lines.push(`Kart POS (TL),${report.summary.cardTotal.toFixed(2)}`);
  lines.push(`Yakit (TL),${report.summary.fuelTotal.toFixed(2)}`);
  lines.push(`Diger (TL),${report.summary.otherTotal.toFixed(2)}`);
  if (isAdmin) {
    lines.push(`Supheli Islem,${report.summary.suspiciousCount}`);
  }
  lines.push("");

  lines.push("POMPACI BAZINDA");
  lines.push("Pompaci,Islem Sayisi,Toplam (TL)" + (isAdmin ? ",Supheli" : ""));
  for (const s of report.staff) {
    lines.push(
      `${s.name},${s.transactionCount},${s.totalAmount.toFixed(2)}` +
        (isAdmin ? `,${s.suspiciousCount}` : "")
    );
  }
  lines.push("");

  if (report.warnings.length) {
    lines.push("UYARILAR");
    for (const w of report.warnings) {
      lines.push(w);
    }
    lines.push("");
  }

  lines.push("ISLEM DETAYI");
  lines.push(
    "Saat,Pompaci,Islem Tipi,Tutar (TL)" + (isAdmin ? ",Durum" : "") + ",Aciklama"
  );

  const SUSPICION_LABELS: Record<string, string> = {
    NORMAL: "Normal",
    SUSPICIOUS_MISMATCH: "Tutarsizlik",
    SUSPICIOUS_DATETIME_MISMATCH: "Tarih/saat uyusmazligi",
    SUSPICIOUS_UNREADABLE: "Fis okunamadi",
    PENDING_OCR: "OCR bekliyor",
    REVIEWED: "Incelendi",
  };

  for (const t of transactions) {
    const status =
      isAdmin && isSuspicious(t.suspicionStatus)
        ? SUSPICION_LABELS[t.suspicionStatus] ?? t.suspicionStatus
        : isAdmin
          ? SUSPICION_LABELS[t.suspicionStatus] ?? "Normal"
          : "";
    lines.push(
      [
        new Date(t.createdAt).toLocaleString("tr-TR"),
        t.createdBy.name,
        TYPE_LABELS[t.type] ?? t.type,
        t.enteredAmount.toFixed(2),
        ...(isAdmin ? [status] : []),
        t.description ?? "",
      ]
        .map((v) => {
          const s = String(v);
          return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    );
  }

  return "\uFEFF" + lines.join("\n");
}

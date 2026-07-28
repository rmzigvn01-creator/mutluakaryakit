import { Router } from "express";
import { ShiftStatus, UserRole, SuspicionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRoles, AuthRequest } from "../middleware/auth.js";
import { logAudit } from "../services/audit.service.js";
import {
  sanitizeTransactionForRole,
  sanitizeTransactionsForRole,
  sanitizeShiftSummaryForRole,
} from "../lib/roles.js";
import { routeId } from "../lib/route-id.js";
import { createShiftQrToken, verifyShiftQrToken } from "../lib/shift-qr.js";

const router = Router();

/**
 * Giriş ekranı (işyeri PC) — oturum gerekmez.
 * Tek istasyon varsayımı; STATION_ID env ile sabitlenebilir.
 */
router.get("/public-qr", async (_req, res) => {
  try {
    const stationId = process.env.STATION_ID?.trim() || null;
    const station = stationId
      ? await prisma.station.findUnique({ where: { id: stationId }, select: { id: true, name: true } })
      : await prisma.station.findFirst({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } });

    if (!station) {
      res.status(404).json({ error: "İstasyon bulunamadı" });
      return;
    }

    const issued = createShiftQrToken(station.id);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      token: issued.token,
      payload: issued.token,
      expiresAt: new Date(issued.expiresAt).toISOString(),
      expiresInMs: issued.expiresInMs,
      windowMs: 30_000,
      stationName: station.name,
    });
  } catch (err) {
    console.error("public-qr failed", err);
    res.status(500).json({ error: "QR üretilemedi" });
  }
});

router.use(authMiddleware);

async function buildShiftSummary(shiftId: string) {
  const transactions = await prisma.transaction.findMany({
    where: { shiftId, isDeleted: false },
  });

  const totalAmount = transactions.reduce((s, t) => s + t.enteredAmount, 0);
  const suspiciousCount = transactions.filter(
    (t) =>
      t.suspicionStatus === SuspicionStatus.SUSPICIOUS_MISMATCH ||
      t.suspicionStatus === SuspicionStatus.SUSPICIOUS_DATETIME_MISMATCH ||
      t.suspicionStatus === SuspicionStatus.SUSPICIOUS_UNREADABLE
  ).length;

  const byType: Record<string, { count: number; total: number }> = {};
  for (const t of transactions) {
    if (!byType[t.type]) byType[t.type] = { count: 0, total: 0 };
    byType[t.type].count++;
    byType[t.type].total += t.enteredAmount;
  }

  return {
    transactionCount: transactions.length,
    totalAmount,
    suspiciousCount,
    averageAmount: transactions.length > 0 ? totalAmount / transactions.length : 0,
    byType,
  };
}

// Aktif vardiya
router.get("/current", async (req: AuthRequest, res) => {
  const userId =
    req.user!.role === UserRole.STAFF ? req.user!.userId : (req.query.userId as string);

  const targetUserId = userId || req.user!.userId;

  if (req.user!.role === UserRole.STAFF && targetUserId !== req.user!.userId) {
    res.status(403).json({ error: "Yetkiniz yok" });
    return;
  }

  const shift = await prisma.shift.findFirst({
    where: {
      userId: targetUserId,
      stationId: req.user!.stationId,
      status: ShiftStatus.OPEN,
    },
    include: { user: { select: { id: true, name: true } } },
  });

  if (!shift) {
    res.json({ shift: null });
    return;
  }

  const summary = await buildShiftSummary(shift.id);
  res.json({
    shift,
    summary: sanitizeShiftSummaryForRole(summary, req.user!.role),
  });
});

/**
 * İşyeri bilgisayarı için dönen QR token (30 sn’de bir değişir).
 * Yalnızca yönetici — istasyon PC’sinde açık tutulur.
 */
router.get("/qr", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const issued = createShiftQrToken(req.user!.stationId);
  res.json({
    token: issued.token,
    expiresAt: new Date(issued.expiresAt).toISOString(),
    expiresInMs: issued.expiresInMs,
    windowMs: 30_000,
    /** Telefonda okutulacak ham içerik */
    payload: issued.token,
  });
});

// Vardiya başlat — yalnızca işyeri ekranındaki güncel QR ile
router.post("/start", requireRoles(UserRole.STAFF, UserRole.ADMIN), async (req: AuthRequest, res) => {
  const { qrToken } = req.body as { qrToken?: string };

  if (!qrToken || !verifyShiftQrToken(qrToken, req.user!.stationId)) {
    res.status(400).json({
      error:
        "Geçersiz veya süresi dolmuş QR. Yalnızca ekrandaki güncel kod geçerli; eski fotoğraf kabul edilmez.",
    });
    return;
  }

  const existing = await prisma.shift.findFirst({
    where: {
      userId: req.user!.userId,
      stationId: req.user!.stationId,
      status: ShiftStatus.OPEN,
    },
  });

  if (existing) {
    res.status(409).json({ error: "Zaten açık bir vardiyanız var", shift: existing });
    return;
  }

  const shift = await prisma.shift.create({
    data: {
      stationId: req.user!.stationId,
      userId: req.user!.userId,
      status: ShiftStatus.OPEN,
    },
    include: { user: { select: { id: true, name: true } } },
  });

  await logAudit(req.user!.userId, "SHIFT_START", "Shift", shift.id, {
    viaQr: Boolean(qrToken),
  });

  res.status(201).json({ shift });
});

// Vardiya bitir
router.post("/:id/end", requireRoles(UserRole.STAFF, UserRole.ADMIN), async (req: AuthRequest, res) => {
  const { note } = req.body as { note?: string };

  const shift = await prisma.shift.findFirst({
    where: {
      id: routeId(req.params.id),
      stationId: req.user!.stationId,
      status: ShiftStatus.OPEN,
      ...(req.user!.role === UserRole.STAFF ? { userId: req.user!.userId } : {}),
    },
  });

  if (!shift) {
    res.status(404).json({ error: "Açık vardiya bulunamadı" });
    return;
  }

  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: {
      status: ShiftStatus.CLOSED,
      endedAt: new Date(),
      closingNote: note?.trim() || null,
    },
    include: { user: { select: { id: true, name: true } } },
  });

  const summary = await buildShiftSummary(shift.id);

  await logAudit(req.user!.userId, "SHIFT_END", "Shift", shift.id, { summary });

  res.json({
    shift: updated,
    summary: sanitizeShiftSummaryForRole(summary, req.user!.role),
  });
});

// Vardiya listesi
router.get("/", async (req: AuthRequest, res) => {
  const { from, to, userId, status } = req.query as Record<string, string>;

  const dateFrom = from
    ? new Date(from)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dateTo = to ? new Date(to) : new Date();

  const where: Record<string, unknown> = {
    stationId: req.user!.stationId,
    startedAt: { gte: dateFrom, lte: dateTo },
  };

  if (req.user!.role === UserRole.STAFF) {
    where.userId = req.user!.userId;
  } else if (userId) {
    where.userId = userId;
  }

  if (status) where.status = status as ShiftStatus;

  const shifts = await prisma.shift.findMany({
    where,
    include: { user: { select: { id: true, name: true } } },
    orderBy: { startedAt: "desc" },
    take: 100,
  });

  const withSummary = await Promise.all(
    shifts.map(async (s) => {
      const summary = await buildShiftSummary(s.id);
      return {
        ...s,
        summary: sanitizeShiftSummaryForRole(summary, req.user!.role),
      };
    })
  );

  res.json({ shifts: withSummary, period: { from: dateFrom, to: dateTo } });
});

// Vardiya detayı
router.get("/:id", async (req: AuthRequest, res) => {
  const shift = await prisma.shift.findFirst({
    where: {
      id: routeId(req.params.id),
      stationId: req.user!.stationId,
      ...(req.user!.role === UserRole.STAFF ? { userId: req.user!.userId } : {}),
    },
    include: {
      user: { select: { id: true, name: true } },
      transactions: {
        where: { isDeleted: false },
        include: { createdBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!shift) {
    res.status(404).json({ error: "Vardiya bulunamadı" });
    return;
  }

  const summary = await buildShiftSummary(shift.id);
  res.json({
    shift: {
      ...shift,
      transactions: sanitizeTransactionsForRole(shift.transactions, req.user!.role),
    },
    summary: sanitizeShiftSummaryForRole(summary, req.user!.role),
  });
});

export default router;

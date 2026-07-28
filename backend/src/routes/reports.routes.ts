import { Router } from "express";
import {
  UserRole,
  SuspicionStatus,
  CorrectionType,
  CorrectionStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRoles, AuthRequest } from "../middleware/auth.js";
import { sanitizeTransactionForRole } from "../lib/roles.js";
import {
  buildDayCloseReport,
  formatDayCloseCsv,
  getTurkeyDayBounds,
  todayTurkeyDateStr,
} from "../services/day-close.service.js";

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(UserRole.ADMIN, UserRole.ACCOUNTANT));

const SHIFT_START_HOUR_TR = 9; // Sabit vardiya başlangıcı 09:00 (İstanbul)
const MAX_GAP_MS = 2 * 60 * 60 * 1000; // işlem süresi için max ara (mola sayılmaz)

function istanbulParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "0";
  return {
    hour: parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
  };
}

/** 09:00'dan kaç dk sonra başladı (0 = zamanında veya erken) */
function minutesLateForShift(startedAt: Date): number {
  const { hour, minute } = istanbulParts(startedAt);
  const startedMins = hour * 60 + minute;
  const dueMins = SHIFT_START_HOUR_TR * 60;
  return Math.max(0, startedMins - dueMins);
}

function avgTransactionGapMinutes(timestamps: Date[]): number | null {
  if (timestamps.length < 2) return null;
  const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].getTime() - sorted[i - 1].getTime();
    if (gap > 0 && gap <= MAX_GAP_MS) gaps.push(gap);
  }
  if (!gaps.length) return null;
  const avgMs = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return Math.round((avgMs / 60000) * 10) / 10;
}

function formatDurationHours(ms: number): number {
  return Math.round((ms / 3600000) * 10) / 10;
}

/** 1–5 yıldız: satış, OCR, iptal, geç kalma */
function computeStarRating(m: {
  transactionCount: number;
  ocrErrorRate: number;
  cancelRate: number;
  lateShiftRate: number;
  avgLateMinutes: number;
}): number {
  let score = 5;
  if (m.transactionCount === 0) return 1;
  if (m.ocrErrorRate > 25) score -= 1.5;
  else if (m.ocrErrorRate > 12) score -= 1;
  else if (m.ocrErrorRate > 5) score -= 0.5;
  if (m.cancelRate > 15) score -= 1.5;
  else if (m.cancelRate > 8) score -= 1;
  else if (m.cancelRate > 3) score -= 0.5;
  if (m.lateShiftRate > 40) score -= 1.5;
  else if (m.lateShiftRate > 20) score -= 1;
  else if (m.avgLateMinutes > 15) score -= 0.5;
  if (m.transactionCount >= 80) score += 0.25;
  return Math.min(5, Math.max(1, Math.round(score * 2) / 2));
}

// Personel performansı
router.get("/staff-performance", async (req: AuthRequest, res) => {
  const { from, to } = req.query as { from?: string; to?: string };

  const dateFrom = from
    ? new Date(from)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const dateTo = to ? new Date(to) : new Date();

  const staff = await prisma.user.findMany({
    where: {
      stationId: req.user!.stationId,
      role: UserRole.STAFF,
      isActive: true,
    },
    select: { id: true, name: true, email: true, username: true },
  });

  const report = await Promise.all(
    staff.map(async (user) => {
      const baseWhere = {
        createdById: user.id,
        stationId: req.user!.stationId,
        isDeleted: false,
        createdAt: { gte: dateFrom, lte: dateTo },
      };

      const [
        count,
        sum,
        mismatch,
        datetimeMismatch,
        unreadable,
        cancelApproved,
        txTimes,
        shifts,
      ] = await Promise.all([
        prisma.transaction.count({ where: baseWhere }),
        prisma.transaction.aggregate({
          where: baseWhere,
          _sum: { enteredAmount: true },
        }),
        prisma.transaction.count({
          where: { ...baseWhere, suspicionStatus: SuspicionStatus.SUSPICIOUS_MISMATCH },
        }),
        prisma.transaction.count({
          where: {
            ...baseWhere,
            suspicionStatus: SuspicionStatus.SUSPICIOUS_DATETIME_MISMATCH,
          },
        }),
        prisma.transaction.count({
          where: { ...baseWhere, suspicionStatus: SuspicionStatus.SUSPICIOUS_UNREADABLE },
        }),
        prisma.correctionRequest.count({
          where: {
            requestedById: user.id,
            type: CorrectionType.DELETE,
            status: CorrectionStatus.APPROVED,
            createdAt: { gte: dateFrom, lte: dateTo },
          },
        }),
        prisma.transaction.findMany({
          where: baseWhere,
          select: { createdAt: true },
          orderBy: { createdAt: "asc" },
          take: 2000,
        }),
        prisma.shift.findMany({
          where: {
            userId: user.id,
            stationId: req.user!.stationId,
            startedAt: { gte: dateFrom, lte: dateTo },
          },
          select: { startedAt: true, endedAt: true, status: true },
        }),
      ]);

      const totalAmount = sum._sum.enteredAmount ?? 0;
      const ocrErrorCount = mismatch + datetimeMismatch + unreadable;
      const ocrErrorRate = count > 0 ? (ocrErrorCount / count) * 100 : 0;
      const cancelDenom = count + cancelApproved;
      const cancelRate = cancelDenom > 0 ? (cancelApproved / cancelDenom) * 100 : 0;
      const avgTxnMinutes = avgTransactionGapMinutes(txTimes.map((t) => t.createdAt));

      let shiftMs = 0;
      let lateCount = 0;
      let lateMinutesSum = 0;
      const now = Date.now();
      for (const sh of shifts) {
        const end = sh.endedAt ? sh.endedAt.getTime() : now;
        shiftMs += Math.max(0, end - sh.startedAt.getTime());
        const late = minutesLateForShift(sh.startedAt);
        if (late > 0) {
          lateCount += 1;
          lateMinutesSum += late;
        }
      }
      const shiftCount = shifts.length;
      const lateShiftRate = shiftCount > 0 ? (lateCount / shiftCount) * 100 : 0;
      const avgLateMinutes =
        lateCount > 0 ? Math.round(lateMinutesSum / lateCount) : 0;

      const starRating = computeStarRating({
        transactionCount: count,
        ocrErrorRate,
        cancelRate,
        lateShiftRate,
        avgLateMinutes,
      });

      const byType = await prisma.transaction.groupBy({
        by: ["type"],
        where: baseWhere,
        _count: { id: true },
        _sum: { enteredAmount: true },
      });

      return {
        staff: user,
        period: { from: dateFrom, to: dateTo },
        transactionCount: count,
        totalAmount,
        averageAmount: count > 0 ? totalAmount / count : 0,
        avgTransactionMinutes: avgTxnMinutes,
        cancelCount: cancelApproved,
        cancelRate: Math.round(cancelRate * 10) / 10,
        ocrErrorCount,
        ocrErrorRate: Math.round(ocrErrorRate * 10) / 10,
        suspiciousCount: ocrErrorCount,
        suspiciousMismatch: mismatch,
        suspiciousDateTime: datetimeMismatch,
        suspiciousUnreadable: unreadable,
        suspiciousRate: Math.round(ocrErrorRate * 10) / 10,
        shiftCount,
        shiftHours: formatDurationHours(shiftMs),
        lateShiftCount: lateCount,
        lateShiftRate: Math.round(lateShiftRate * 10) / 10,
        avgLateMinutes,
        starRating,
        shiftStartHour: SHIFT_START_HOUR_TR,
        breakdownByType: byType.map((b) => ({
          type: b.type,
          count: b._count.id,
          totalAmount: b._sum.enteredAmount ?? 0,
        })),
      };
    })
  );

  report.sort((a, b) => {
    if (b.starRating !== a.starRating) return b.starRating - a.starRating;
    return b.totalAmount - a.totalAmount;
  });

  const staffReport =
    req.user!.role === UserRole.ADMIN
      ? report
      : report.map((r) => ({
          ...r,
          suspiciousCount: 0,
          suspiciousMismatch: 0,
          suspiciousDateTime: 0,
          suspiciousUnreadable: 0,
          suspiciousRate: 0,
          ocrErrorCount: 0,
          ocrErrorRate: 0,
        }));

  res.json({
    period: { from: dateFrom, to: dateTo },
    shiftStartHour: SHIFT_START_HOUR_TR,
    staff: staffReport,
  });
});

// Dönem özeti
router.get("/period-summary", async (req: AuthRequest, res) => {
  const { from, to } = req.query as { from?: string; to?: string };

  const dateFrom = from
    ? new Date(from)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const dateTo = to ? new Date(to) : new Date();

  const where = {
    stationId: req.user!.stationId,
    isDeleted: false,
    createdAt: { gte: dateFrom, lte: dateTo },
  };

  const [count, sum, byType, suspicious] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.aggregate({ where, _sum: { enteredAmount: true } }),
    prisma.transaction.groupBy({
      by: ["type"],
      where,
      _count: { id: true },
      _sum: { enteredAmount: true },
    }),
    prisma.transaction.count({
      where: {
        ...where,
        suspicionStatus: {
          in: [
            SuspicionStatus.SUSPICIOUS_MISMATCH,
            SuspicionStatus.SUSPICIOUS_DATETIME_MISMATCH,
            SuspicionStatus.SUSPICIOUS_UNREADABLE,
          ],
        },
      },
    }),
  ]);

  res.json({
    period: { from: dateFrom, to: dateTo },
    transactionCount: count,
    totalAmount: sum._sum.enteredAmount ?? 0,
    suspiciousCount: req.user!.role === UserRole.ADMIN ? suspicious : 0,
    byType: byType.map((b) => ({
      type: b.type,
      count: b._count.id,
      totalAmount: b._sum.enteredAmount ?? 0,
    })),
  });
});

const TYPE_LABELS: Record<string, string> = {
  FUEL_BENZIN: "Benzin",
  FUEL_MOTORIN: "Motorin",
  CARD_POS: "Kart (POS)",
  CASH: "Nakit",
  OTHER: "Diğer",
};

const SUSPICION_LABELS: Record<string, string> = {
  NORMAL: "Normal",
  SUSPICIOUS_MISMATCH: "Tutarsizlik",
  SUSPICIOUS_DATETIME_MISMATCH: "Tarih/saat uyusmazligi",
  SUSPICIOUS_UNREADABLE: "Fis okunamadi",
  PENDING_OCR: "OCR bekliyor",
  REVIEWED: "Incelendi",
};

function escapeCsv(val: string | number | null | undefined): string {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// CSV dışa aktarma (Excel uyumlu)
router.get("/export-csv", async (req: AuthRequest, res) => {
  const { from, to } = req.query as { from?: string; to?: string };

  const dateFrom = from
    ? new Date(from)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const dateTo = to ? new Date(to) : new Date();

  const transactions = await prisma.transaction.findMany({
    where: {
      stationId: req.user!.stationId,
      isDeleted: false,
      createdAt: { gte: dateFrom, lte: dateTo },
    },
    include: { createdBy: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const headers = [
    "Tarih",
    "Pompaci",
    "Islem Tipi",
    "Girilen Tutar",
    "Fis Tutari",
    "Fark",
    "Durum",
    "Aciklama",
  ];

  const rows = transactions.map((t) => {
    const safe = sanitizeTransactionForRole(t, req.user!.role);
    return [
      new Date(t.createdAt).toLocaleString("tr-TR"),
      t.createdBy.name,
      TYPE_LABELS[t.type] || t.type,
      t.enteredAmount.toFixed(2),
      req.user!.role === UserRole.ADMIN ? (t.receiptAmount?.toFixed(2) ?? "") : "",
      req.user!.role === UserRole.ADMIN ? (t.amountDiff?.toFixed(2) ?? "") : "",
      SUSPICION_LABELS[safe.suspicionStatus] || safe.suspicionStatus,
      t.description ?? "",
    ]
      .map(escapeCsv)
      .join(",");
  });

  const csv = "\uFEFF" + [headers.join(","), ...rows].join("\n");
  const filename = `mutluakaryakit-${dateFrom.toISOString().slice(0, 10)}_${dateTo.toISOString().slice(0, 10)}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

// Gün sonu kapanış raporu
router.get("/day-close", async (req: AuthRequest, res) => {
  const date = (req.query.date as string) || todayTurkeyDateStr();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Geçersiz tarih formatı (YYYY-MM-DD)" });
    return;
  }

  const report = await buildDayCloseReport(req.user!.stationId, date, req.user!.role);
  res.json({ report });
});

// Gün sonu raporu CSV indir
router.get("/day-close/export", async (req: AuthRequest, res) => {
  const date = (req.query.date as string) || todayTurkeyDateStr();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Geçersiz tarih formatı (YYYY-MM-DD)" });
    return;
  }

  const { from, to } = getTurkeyDayBounds(date);
  const [report, transactions] = await Promise.all([
    buildDayCloseReport(req.user!.stationId, date, req.user!.role),
    prisma.transaction.findMany({
      where: {
        stationId: req.user!.stationId,
        isDeleted: false,
        createdAt: { gte: from, lte: to },
      },
      include: { createdBy: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const csv = formatDayCloseCsv(report, req.user!.role, transactions);
  const filename = `gun-sonu-${date}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

export default router;

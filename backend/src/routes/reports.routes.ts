import { Router } from "express";
import { UserRole, SuspicionStatus } from "@prisma/client";
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

// Pompacı performans analizi
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
    },
    select: { id: true, name: true, email: true },
  });

  const report = await Promise.all(
    staff.map(async (user) => {
      const baseWhere = {
        createdById: user.id,
        stationId: req.user!.stationId,
        isDeleted: false,
        createdAt: { gte: dateFrom, lte: dateTo },
      };

      const [count, sum, mismatch, datetimeMismatch, unreadable, corrections] = await Promise.all([
        prisma.transaction.count({ where: baseWhere }),
        prisma.transaction.aggregate({
          where: baseWhere,
          _sum: { enteredAmount: true },
        }),
        prisma.transaction.count({
          where: {
            ...baseWhere,
            suspicionStatus: SuspicionStatus.SUSPICIOUS_MISMATCH,
          },
        }),
        prisma.transaction.count({
          where: {
            ...baseWhere,
            suspicionStatus: SuspicionStatus.SUSPICIOUS_DATETIME_MISMATCH,
          },
        }),
        prisma.transaction.count({
          where: {
            ...baseWhere,
            suspicionStatus: SuspicionStatus.SUSPICIOUS_UNREADABLE,
          },
        }),
        prisma.correctionRequest.count({
          where: {
            requestedById: user.id,
            createdAt: { gte: dateFrom, lte: dateTo },
          },
        }),
      ]);

      const totalAmount = sum._sum.enteredAmount ?? 0;
      const suspiciousTotal = mismatch + datetimeMismatch + unreadable;
      const suspiciousRate = count > 0 ? (suspiciousTotal / count) * 100 : 0;

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
        suspiciousCount: suspiciousTotal,
        suspiciousMismatch: mismatch,
        suspiciousDateTime: datetimeMismatch,
        suspiciousUnreadable: unreadable,
        suspiciousRate: Math.round(suspiciousRate * 100) / 100,
        correctionRequestCount: corrections,
        breakdownByType: byType.map((b) => ({
          type: b.type,
          count: b._count.id,
          totalAmount: b._sum.enteredAmount ?? 0,
        })),
      };
    })
  );

  report.sort((a, b) => b.totalAmount - a.totalAmount);

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
        }));

  res.json({
    period: { from: dateFrom, to: dateTo },
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

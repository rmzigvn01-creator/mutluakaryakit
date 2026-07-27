import { Router } from "express";
import { SuspicionStatus, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRoles, AuthRequest } from "../middleware/auth.js";
import { logAudit } from "../services/audit.service.js";
import { routeId } from "../lib/route-id.js";

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(UserRole.ADMIN));

// Şüpheli işlemler listesi
router.get("/suspicious", async (req: AuthRequest, res) => {
  const { reviewed = "false", limit = "50" } = req.query as {
    reviewed?: string;
    limit?: string;
  };
  const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

  const statuses =
    reviewed === "true"
      ? [SuspicionStatus.REVIEWED]
      : [
          SuspicionStatus.SUSPICIOUS_MISMATCH,
          SuspicionStatus.SUSPICIOUS_DATETIME_MISMATCH,
          SuspicionStatus.SUSPICIOUS_UNREADABLE,
          SuspicionStatus.PENDING_OCR,
        ];

  const [transactions, count] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        stationId: req.user!.stationId,
        isDeleted: false,
        suspicionStatus: { in: statuses },
      },
      // Fiş binary'sini (receiptData) çekme — listeyi MB'larca şişirir
      select: {
        id: true,
        type: true,
        enteredAmount: true,
        receiptAmount: true,
        receiptDateTime: true,
        amountDiff: true,
        description: true,
        suspicionStatus: true,
        suspicionNote: true,
        createdAt: true,
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.transaction.count({
      where: {
        stationId: req.user!.stationId,
        isDeleted: false,
        suspicionStatus: { in: statuses },
      },
    }),
  ]);

  res.json({ transactions, count });
});

// Şüpheli işlemi incele / not ekle
router.post("/suspicious/:id/review", async (req: AuthRequest, res) => {
  const { note } = req.body as { note?: string };

  const transaction = await prisma.transaction.findFirst({
    where: {
      id: routeId(req.params.id),
      stationId: req.user!.stationId,
      isDeleted: false,
    },
    select: { id: true },
  });

  if (!transaction) {
    res.status(404).json({ error: "İşlem bulunamadı" });
    return;
  }

  const updated = await prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      suspicionStatus: SuspicionStatus.REVIEWED,
      suspicionNote: note || null,
      reviewedById: req.user!.userId,
      reviewedAt: new Date(),
    },
    select: {
      id: true,
      suspicionStatus: true,
      suspicionNote: true,
      reviewedAt: true,
      createdBy: { select: { id: true, name: true } },
    },
  });

  await logAudit(req.user!.userId, "SUSPICION_REVIEW", "Transaction", transaction.id, {
    note,
  });

  res.json({ transaction: updated });
});

// Dashboard özet
router.get("/dashboard", async (req: AuthRequest, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    todayCount,
    todayTotal,
    pendingCorrections,
    suspiciousCount,
    pendingOcr,
  ] = await Promise.all([
    prisma.transaction.count({
      where: { stationId: req.user!.stationId, isDeleted: false, createdAt: { gte: today } },
    }),
    prisma.transaction.aggregate({
      where: { stationId: req.user!.stationId, isDeleted: false, createdAt: { gte: today } },
      _sum: { enteredAmount: true },
    }),
    prisma.correctionRequest.count({
      where: {
        status: "PENDING",
        transaction: { stationId: req.user!.stationId },
      },
    }),
    prisma.transaction.count({
      where: {
        stationId: req.user!.stationId,
        isDeleted: false,
        suspicionStatus: {
          in: [
            SuspicionStatus.SUSPICIOUS_MISMATCH,
            SuspicionStatus.SUSPICIOUS_DATETIME_MISMATCH,
            SuspicionStatus.SUSPICIOUS_UNREADABLE,
          ],
        },
      },
    }),
    prisma.transaction.count({
      where: {
        stationId: req.user!.stationId,
        isDeleted: false,
        suspicionStatus: SuspicionStatus.PENDING_OCR,
      },
    }),
  ]);

  res.json({
    today: {
      transactionCount: todayCount,
      totalAmount: todayTotal._sum.enteredAmount ?? 0,
    },
    pendingCorrections,
    suspiciousCount,
    pendingOcr,
  });
});

export default router;

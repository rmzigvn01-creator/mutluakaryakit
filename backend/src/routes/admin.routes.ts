import { Router } from "express";
import bcrypt from "bcryptjs";
import { SuspicionStatus, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRoles, AuthRequest } from "../middleware/auth.js";
import { logAudit } from "../services/audit.service.js";
import { routeId } from "../lib/route-id.js";

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(UserRole.ADMIN));

const USER_ROLES = new Set<UserRole>([
  UserRole.STAFF,
  UserRole.ACCOUNTANT,
  UserRole.ADMIN,
]);

function publicUser(user: {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

// Personel / üye listesi
router.get("/users", async (req: AuthRequest, res) => {
  const users = await prisma.user.findMany({
    where: { stationId: req.user!.stationId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
  });

  res.json({ users: users.map(publicUser) });
});

// Yeni üye ekle
router.post("/users", async (req: AuthRequest, res) => {
  const { name, email, password, role } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    role?: UserRole;
  };

  const trimmedName = name?.trim() || "";
  const trimmedEmail = email?.trim().toLowerCase() || "";
  const userRole = role && USER_ROLES.has(role) ? role : null;

  if (!trimmedName || !trimmedEmail || !password || !userRole) {
    res.status(400).json({ error: "Ad, e-posta, şifre ve rol gerekli" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Şifre en az 6 karakter olmalı" });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    res.status(400).json({ error: "Geçerli bir e-posta girin" });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email: trimmedEmail } });
  if (existing) {
    res.status(409).json({ error: "Bu e-posta zaten kayıtlı" });
    return;
  }

  const user = await prisma.user.create({
    data: {
      name: trimmedName,
      email: trimmedEmail,
      passwordHash: await bcrypt.hash(password, 10),
      role: userRole,
      stationId: req.user!.stationId,
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  await logAudit(req.user!.userId, "USER_CREATE", "User", user.id, {
    email: user.email,
    role: user.role,
  });

  res.status(201).json({ user: publicUser(user) });
});

// Üye güncelle (ad, rol, aktiflik, isteğe bağlı şifre)
router.patch("/users/:id", async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const { name, role, isActive, password } = req.body as {
    name?: string;
    role?: UserRole;
    isActive?: boolean;
    password?: string;
  };

  const target = await prisma.user.findFirst({
    where: { id, stationId: req.user!.stationId },
  });
  if (!target) {
    res.status(404).json({ error: "Kullanıcı bulunamadı" });
    return;
  }

  const data: {
    name?: string;
    role?: UserRole;
    isActive?: boolean;
    passwordHash?: string;
  } = {};

  if (typeof name === "string" && name.trim()) data.name = name.trim();

  if (role !== undefined) {
    if (!USER_ROLES.has(role)) {
      res.status(400).json({ error: "Geçersiz rol" });
      return;
    }
    data.role = role;
  }

  if (typeof isActive === "boolean") {
    if (id === req.user!.userId && isActive === false) {
      res.status(400).json({ error: "Kendi hesabınızı pasifleştiremezsiniz" });
      return;
    }
    data.isActive = isActive;
  }

  if (password !== undefined && password !== "") {
    if (password.length < 6) {
      res.status(400).json({ error: "Şifre en az 6 karakter olmalı" });
      return;
    }
    data.passwordHash = await bcrypt.hash(password, 10);
  }

  const nextRole = data.role ?? target.role;
  const nextActive = data.isActive ?? target.isActive;
  const wouldRemoveAdmin =
    target.role === UserRole.ADMIN &&
    target.isActive &&
    (nextRole !== UserRole.ADMIN || nextActive === false);

  if (wouldRemoveAdmin) {
    const otherAdmins = await prisma.user.count({
      where: {
        stationId: req.user!.stationId,
        role: UserRole.ADMIN,
        isActive: true,
        id: { not: id },
      },
    });
    if (otherAdmins === 0) {
      res.status(400).json({ error: "Son aktif yöneticiyi kaldıramazsınız" });
      return;
    }
  }

  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "Güncellenecek alan yok" });
    return;
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  await logAudit(req.user!.userId, "USER_UPDATE", "User", user.id, {
    name: data.name,
    role: data.role,
    isActive: data.isActive,
    passwordReset: Boolean(data.passwordHash),
  });

  res.json({ user: publicUser(user) });
});

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

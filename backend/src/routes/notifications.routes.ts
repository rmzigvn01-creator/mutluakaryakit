import { Router } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRoles, AuthRequest } from "../middleware/auth.js";
import { isPushConfigured, sendTestPushToUser } from "../services/push.service.js";
import { routeId } from "../lib/route-id.js";

const router = Router();

router.use(authMiddleware);

// Cihaz token kaydı (iOS/Android — sadece yönetici)
router.post("/devices", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const { token, platform = "ios" } = req.body as { token?: string; platform?: string };

  if (!token?.trim()) {
    res.status(400).json({ error: "token gerekli" });
    return;
  }

  const device = await prisma.pushDevice.upsert({
    where: {
      userId_token: { userId: req.user!.userId, token: token.trim() },
    },
    update: { platform, updatedAt: new Date() },
    create: {
      userId: req.user!.userId,
      token: token.trim(),
      platform,
    },
  });

  res.json({ device, pushConfigured: isPushConfigured() });
});

// Cihaz token sil (çıkış)
router.delete("/devices", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const { token } = req.body as { token?: string };
  if (token) {
    await prisma.pushDevice.deleteMany({
      where: { userId: req.user!.userId, token },
    });
  }
  res.json({ ok: true });
});

// Bildirim listesi
router.get("/", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const notifications = await prisma.appNotification.findMany({
    where: { userId: req.user!.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const unreadCount = await prisma.appNotification.count({
    where: { userId: req.user!.userId, isRead: false },
  });

  res.json({ notifications, unreadCount });
});

// Okundu işaretle
router.post("/:id/read", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const notification = await prisma.appNotification.findFirst({
    where: { id: routeId(req.params.id), userId: req.user!.userId },
  });

  if (!notification) {
    res.status(404).json({ error: "Bildirim bulunamadı" });
    return;
  }

  const updated = await prisma.appNotification.update({
    where: { id: notification.id },
    data: { isRead: true },
  });

  res.json({ notification: updated });
});

// Tümünü okundu işaretle
router.post("/read-all", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  await prisma.appNotification.updateMany({
    where: { userId: req.user!.userId, isRead: false },
    data: { isRead: true },
  });
  res.json({ ok: true });
});

// Test bildirimi
router.post("/test", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const result = await sendTestPushToUser(req.user!.userId);

  if (result.devices === 0) {
    res.status(400).json({
      error: "Kayıtlı cihaz yok. iOS uygulamasından yönetici olarak giriş yapın.",
    });
    return;
  }

  res.json({
    message: `${result.sent}/${result.devices} cihaza test bildirimi gönderildi`,
    pushConfigured: isPushConfigured(),
    ...result,
  });
});

// Push durumu
router.get("/status", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const deviceCount = await prisma.pushDevice.count({
    where: { userId: req.user!.userId },
  });

  res.json({
    pushConfigured: isPushConfigured(),
    registeredDevices: deviceCount,
  });
});

export default router;

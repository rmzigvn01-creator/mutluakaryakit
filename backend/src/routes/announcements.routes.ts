import { Router } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRoles, AuthRequest } from "../middleware/auth.js";
import { logAudit } from "../services/audit.service.js";
import { routeId } from "../lib/route-id.js";

const router = Router();

router.use(authMiddleware);

function publicAnnouncement(a: {
  id: string;
  title: string;
  body: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { id: string; name: string } | null;
}) {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    isActive: a.isActive,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    createdBy: a.createdBy || null,
  };
}

/** Aktif duyurular — tüm roller (ana sayfa) */
router.get("/", async (req: AuthRequest, res) => {
  const announcements = await prisma.announcement.findMany({
    where: { stationId: req.user!.stationId, isActive: true },
    select: {
      id: true,
      title: true,
      body: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  res.json({ announcements: announcements.map(publicAnnouncement) });
});

/** Yönetici: tüm duyurular */
router.get("/manage", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const announcements = await prisma.announcement.findMany({
    where: { stationId: req.user!.stationId },
    select: {
      id: true,
      title: true,
      body: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  res.json({ announcements: announcements.map(publicAnnouncement) });
});

router.post("/", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const { title, body, isActive } = req.body as {
    title?: string;
    body?: string;
    isActive?: boolean;
  };
  const trimmedTitle = title?.trim() || "";
  const trimmedBody = body?.trim() || "";
  if (!trimmedTitle || !trimmedBody) {
    res.status(400).json({ error: "Başlık ve duyuru metni gerekli" });
    return;
  }
  if (trimmedTitle.length > 120) {
    res.status(400).json({ error: "Başlık en fazla 120 karakter olabilir" });
    return;
  }
  if (trimmedBody.length > 4000) {
    res.status(400).json({ error: "Duyuru metni çok uzun" });
    return;
  }

  const announcement = await prisma.announcement.create({
    data: {
      stationId: req.user!.stationId,
      title: trimmedTitle,
      body: trimmedBody,
      isActive: isActive !== false,
      createdById: req.user!.userId,
    },
    select: {
      id: true,
      title: true,
      body: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { id: true, name: true } },
    },
  });

  await logAudit(req.user!.userId, "ANNOUNCEMENT_CREATE", "Announcement", announcement.id, {
    title: announcement.title,
  });

  res.status(201).json({ announcement: publicAnnouncement(announcement) });
});

router.patch("/:id", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const { title, body, isActive } = req.body as {
    title?: string;
    body?: string;
    isActive?: boolean;
  };

  const existing = await prisma.announcement.findFirst({
    where: { id, stationId: req.user!.stationId },
  });
  if (!existing) {
    res.status(404).json({ error: "Duyuru bulunamadı" });
    return;
  }

  const data: { title?: string; body?: string; isActive?: boolean } = {};
  if (typeof title === "string") {
    const t = title.trim();
    if (!t) {
      res.status(400).json({ error: "Başlık boş olamaz" });
      return;
    }
    if (t.length > 120) {
      res.status(400).json({ error: "Başlık en fazla 120 karakter olabilir" });
      return;
    }
    data.title = t;
  }
  if (typeof body === "string") {
    const b = body.trim();
    if (!b) {
      res.status(400).json({ error: "Duyuru metni boş olamaz" });
      return;
    }
    if (b.length > 4000) {
      res.status(400).json({ error: "Duyuru metni çok uzun" });
      return;
    }
    data.body = b;
  }
  if (typeof isActive === "boolean") data.isActive = isActive;

  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "Güncellenecek alan yok" });
    return;
  }

  const announcement = await prisma.announcement.update({
    where: { id },
    data,
    select: {
      id: true,
      title: true,
      body: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { id: true, name: true } },
    },
  });

  await logAudit(req.user!.userId, "ANNOUNCEMENT_UPDATE", "Announcement", announcement.id, data);
  res.json({ announcement: publicAnnouncement(announcement) });
});

router.delete("/:id", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const existing = await prisma.announcement.findFirst({
    where: { id, stationId: req.user!.stationId },
  });
  if (!existing) {
    res.status(404).json({ error: "Duyuru bulunamadı" });
    return;
  }

  await prisma.announcement.delete({ where: { id } });
  await logAudit(req.user!.userId, "ANNOUNCEMENT_DELETE", "Announcement", id, {
    title: existing.title,
  });
  res.json({ ok: true });
});

export default router;

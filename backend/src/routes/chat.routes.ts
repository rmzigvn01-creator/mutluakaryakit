import { Router } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRoles, AuthRequest } from "../middleware/auth.js";
import { routeId } from "../lib/route-id.js";

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(UserRole.ADMIN, UserRole.STAFF, UserRole.ACCOUNTANT));

const MAX_BODY = 1000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function publicMessage(m: {
  id: string;
  body: string;
  createdAt: Date;
  user: { id: string; name: string; role: UserRole; username: string | null };
}) {
  return {
    id: m.id,
    body: m.body,
    createdAt: m.createdAt,
    user: {
      id: m.user.id,
      name: m.user.name,
      role: m.user.role,
      username: m.user.username,
    },
  };
}

/** İstasyon sohbeti — geçmiş veya after ile yeni mesajlar */
router.get("/", async (req: AuthRequest, res) => {
  const after = typeof req.query.after === "string" ? req.query.after.trim() : "";
  const before = typeof req.query.before === "string" ? req.query.before.trim() : "";
  const take = Math.min(
    Math.max(parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  const where: {
    stationId: string;
    createdAt?: { gt?: Date; lt?: Date };
  } = { stationId: req.user!.stationId };

  if (after) {
    const anchor = await prisma.chatMessage.findFirst({
      where: { id: after, stationId: req.user!.stationId },
      select: { createdAt: true },
    });
    if (anchor) where.createdAt = { ...(where.createdAt || {}), gt: anchor.createdAt };
  } else if (before) {
    const anchor = await prisma.chatMessage.findFirst({
      where: { id: before, stationId: req.user!.stationId },
      select: { createdAt: true },
    });
    if (anchor) where.createdAt = { ...(where.createdAt || {}), lt: anchor.createdAt };
  }

  const messages = await prisma.chatMessage.findMany({
    where,
    select: {
      id: true,
      body: true,
      createdAt: true,
      user: { select: { id: true, name: true, role: true, username: true } },
    },
    orderBy: { createdAt: after ? "asc" : "desc" },
    take,
  });

  const ordered = after ? messages : messages.reverse();
  res.json({ messages: ordered.map(publicMessage) });
});

router.post("/", async (req: AuthRequest, res) => {
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) {
    res.status(400).json({ error: "Mesaj boş olamaz" });
    return;
  }
  if (body.length > MAX_BODY) {
    res.status(400).json({ error: `Mesaj en fazla ${MAX_BODY} karakter olabilir` });
    return;
  }

  const message = await prisma.chatMessage.create({
    data: {
      stationId: req.user!.stationId,
      userId: req.user!.userId,
      body,
    },
    select: {
      id: true,
      body: true,
      createdAt: true,
      user: { select: { id: true, name: true, role: true, username: true } },
    },
  });

  res.status(201).json({ message: publicMessage(message) });
});

/** Yönetici veya kendi mesajını silebilir */
router.delete("/:id", async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const existing = await prisma.chatMessage.findFirst({
    where: { id, stationId: req.user!.stationId },
    select: { id: true, userId: true },
  });
  if (!existing) {
    res.status(404).json({ error: "Mesaj bulunamadı" });
    return;
  }
  if (existing.userId !== req.user!.userId && req.user!.role !== UserRole.ADMIN) {
    res.status(403).json({ error: "Bu mesajı silemezsiniz" });
    return;
  }

  await prisma.chatMessage.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;

import { Router } from "express";
import bcrypt from "bcryptjs";
import { ShiftStatus, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import { normalizeUsername } from "../lib/username.js";
import { verifyShiftQrToken } from "../lib/shift-qr.js";
import { logAudit } from "../services/audit.service.js";

const router = Router();

async function findUserByLogin(rawLogin: string) {
  const nick = normalizeUsername(rawLogin);
  return prisma.user.findFirst({
    where: {
      OR: [
        { username: nick },
        { email: nick },
        ...(rawLogin.includes("@") ? [{ email: rawLogin.toLowerCase() }] : []),
      ],
    },
    include: { station: true },
  });
}

function publicAuthUser(user: {
  id: string;
  username: string | null;
  email: string | null;
  name: string;
  role: UserRole;
  stationId: string;
  station: { name: string };
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    stationId: user.stationId,
    stationName: user.station.name,
  };
}

router.post("/login", async (req, res) => {
  const { username, email, password, login } = req.body as {
    username?: string;
    email?: string;
    password?: string;
    login?: string;
  };

  const rawLogin = (username || login || email || "").trim();
  if (!rawLogin || !password) {
    res.status(400).json({ error: "Kullanıcı adı ve şifre gerekli" });
    return;
  }

  const user = await findUserByLogin(rawLogin);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
    return;
  }

  if (!user.isActive) {
    res.status(403).json({ error: "Bu hesap pasif. Yöneticiyle iletişime geçin." });
    return;
  }

  const token = signToken({
    userId: user.id,
    role: user.role,
    stationId: user.stationId,
  });

  res.json({
    token,
    user: publicAuthUser(user),
  });
});

/**
 * Giriş + QR ile vardiya başlat (telefon).
 * Kullanıcı adı/şifre + işyeri ekranındaki güncel QR gerekir.
 */
router.post("/login-shift", async (req, res) => {
  const { username, email, password, login, qrToken } = req.body as {
    username?: string;
    email?: string;
    password?: string;
    login?: string;
    qrToken?: string;
  };

  const rawLogin = (username || login || email || "").trim();
  if (!rawLogin || !password) {
    res.status(400).json({ error: "Kullanıcı adı ve şifre gerekli" });
    return;
  }
  if (!qrToken) {
    res.status(400).json({ error: "QR kod gerekli" });
    return;
  }

  const user = await findUserByLogin(rawLogin);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
    return;
  }
  if (!user.isActive) {
    res.status(403).json({ error: "Bu hesap pasif. Yöneticiyle iletişime geçin." });
    return;
  }
  if (user.role !== UserRole.STAFF && user.role !== UserRole.ADMIN) {
    res.status(403).json({ error: "Bu hesap vardiya başlatamaz" });
    return;
  }

  if (!verifyShiftQrToken(qrToken, user.stationId)) {
    res.status(400).json({
      error:
        "Geçersiz veya süresi dolmuş QR. İşyeri ekranındaki güncel kodu okutun (30 sn).",
    });
    return;
  }

  const existing = await prisma.shift.findFirst({
    where: {
      userId: user.id,
      stationId: user.stationId,
      status: ShiftStatus.OPEN,
    },
  });

  const token = signToken({
    userId: user.id,
    role: user.role,
    stationId: user.stationId,
  });

  if (existing) {
    res.json({
      token,
      user: publicAuthUser(user),
      shift: existing,
      alreadyOpen: true,
      message: "Giriş yapıldı — zaten açık vardiyanız var",
    });
    return;
  }

  const shift = await prisma.shift.create({
    data: {
      stationId: user.stationId,
      userId: user.id,
      status: ShiftStatus.OPEN,
    },
    include: { user: { select: { id: true, name: true } } },
  });

  await logAudit(user.id, "SHIFT_START", "Shift", shift.id, {
    viaQr: true,
    loginShift: true,
  });

  res.status(201).json({
    token,
    user: publicAuthUser(user),
    shift,
    alreadyOpen: false,
    message: "Giriş yapıldı — vardiya başlatıldı",
  });
});

router.get("/me", async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Oturum gerekli" });
    return;
  }

  try {
    const { verifyToken } = await import("../lib/jwt.js");
    const payload = verifyToken(header.slice(7));
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { station: true },
    });

    if (!user) {
      res.status(404).json({ error: "Kullanıcı bulunamadı" });
      return;
    }

    res.json(publicAuthUser(user));
  } catch {
    res.status(401).json({ error: "Geçersiz oturum" });
  }
});

export default router;

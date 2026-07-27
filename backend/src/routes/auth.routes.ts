import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import { normalizeUsername } from "../lib/username.js";

const router = Router();

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

  const nick = normalizeUsername(rawLogin);
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: nick },
        { email: nick },
        ...(rawLogin.includes("@") ? [{ email: rawLogin.toLowerCase() }] : []),
      ],
    },
    include: { station: true },
  });

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
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      stationId: user.stationId,
      stationName: user.station.name,
    },
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

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      stationId: user.stationId,
      stationName: user.station.name,
    });
  } catch {
    res.status(401).json({ error: "Geçersiz oturum" });
  }
});

export default router;

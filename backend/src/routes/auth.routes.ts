import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "E-posta ve şifre gerekli" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { station: true },
  });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "E-posta veya şifre hatalı" });
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

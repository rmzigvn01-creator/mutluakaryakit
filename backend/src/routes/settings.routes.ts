import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";

const router = Router();

router.use(authMiddleware);

router.post("/change-password", async (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword || newPassword.length < 6) {
    res.status(400).json({ error: "Mevcut şifre ve yeni şifre (min 6 karakter) gerekli" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    res.status(401).json({ error: "Mevcut şifre hatalı" });
    return;
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });

  res.json({ message: "Şifre güncellendi" });
});

export default router;

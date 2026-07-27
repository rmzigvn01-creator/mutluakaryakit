import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";
import { verifyToken, JwtPayload } from "../lib/jwt.js";

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Oturum gerekli" });
    return;
  }

  try {
    const token = header.slice(7);
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Geçersiz oturum" });
  }
}

export function requireRoles(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
      return;
    }
    next();
  };
}

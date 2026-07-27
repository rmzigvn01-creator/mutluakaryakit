import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { config } from "../lib/config.js";

export interface JwtPayload {
  userId: string;
  role: UserRole;
  stationId: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "30d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}

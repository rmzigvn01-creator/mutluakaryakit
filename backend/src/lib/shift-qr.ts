import crypto from "crypto";
import { config } from "./config.js";

/** Vardiya QR geçerlilik penceresi */
export const SHIFT_QR_WINDOW_MS = 30_000;

export function shiftQrWindow(now = Date.now()): number {
  return Math.floor(now / SHIFT_QR_WINDOW_MS);
}

function signWindow(stationId: string, window: number): string {
  const payload = `${stationId}.${window}`;
  return crypto
    .createHmac("sha256", config.jwtSecret)
    .update(payload)
    .digest("base64url")
    .slice(0, 24);
}

/** İstasyon + zaman penceresi imzalı token (30 sn’de bir değişir) */
export function createShiftQrToken(stationId: string, now = Date.now()): {
  token: string;
  window: number;
  expiresAt: number;
  expiresInMs: number;
} {
  const window = shiftQrWindow(now);
  const sig = signWindow(stationId, window);
  const token = `MUTLU.${window}.${sig}`;
  const expiresAt = (window + 1) * SHIFT_QR_WINDOW_MS;
  return {
    token,
    window,
    expiresAt,
    expiresInMs: Math.max(0, expiresAt - now),
  };
}

/**
 * Token doğrula. Saat kayması için mevcut + bir önceki pencere kabul edilir.
 * Eski ekran görüntüsü / kopyalanmış QR böylece geçersiz kalır.
 */
export function verifyShiftQrToken(
  rawToken: string,
  stationId: string,
  now = Date.now()
): boolean {
  const token = String(rawToken || "")
    .trim()
    .replace(/^https?:\/\/[^\s#?]+[?#]shiftQr=/i, "")
    .replace(/^shiftQr=/i, "");
  const m = /^MUTLU\.(\d+)\.([A-Za-z0-9_-]{16,64})$/.exec(token);
  if (!m) return false;
  const window = parseInt(m[1], 10);
  const sig = m[2];
  if (!Number.isFinite(window)) return false;

  const current = shiftQrWindow(now);
  // Sadece şu anki ve bir önceki 30 sn penceresi
  if (window !== current && window !== current - 1) return false;
  const expected = signWindow(stationId, window);
  try {
    return (
      sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    );
  } catch {
    return false;
  }
}

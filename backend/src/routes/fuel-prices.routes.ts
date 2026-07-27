import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";
import {
  getLatestFuelPrices,
  refreshFuelPrices,
} from "../services/fuel-price.service.js";
import { requireRoles } from "../middleware/auth.js";
import { UserRole } from "@prisma/client";
import { config } from "../lib/config.js";

const router = Router();

router.use(authMiddleware);

router.get("/current", async (_req: AuthRequest, res) => {
  try {
    let prices = await getLatestFuelPrices();
    if (!prices) {
      prices = await refreshFuelPrices();
    }
    res.json({
      prices,
      pollIntervalMs: config.fuelPricePollIntervalMs,
      location: {
        city: config.fuelPriceCityName,
        district: config.fuelPriceDistrictName,
      },
    });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Fiyatlar alınamadı",
    });
  }
});

router.get("/history", async (req: AuthRequest, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "24"), 10)));
  const rows = await prisma.fuelPriceSnapshot.findMany({
    where: { districtId: config.fuelPriceDistrictId },
    orderBy: { fetchedAt: "desc" },
    take: limit,
  });
  res.json({ history: rows });
});

/** Yönetici: hemen yenile */
router.post("/refresh", requireRoles(UserRole.ADMIN), async (_req: AuthRequest, res) => {
  try {
    const prices = await refreshFuelPrices();
    res.json({ prices });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Fiyatlar yenilenemedi",
    });
  }
});

export default router;

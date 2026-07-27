import { Router } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRoles, AuthRequest } from "../middleware/auth.js";
import { logAudit } from "../services/audit.service.js";
import { routeId } from "../lib/route-id.js";

const router = Router();

router.use(authMiddleware);

function parseFillFilters(query: Record<string, string | undefined>) {
  const { from, to, minAmount, maxAmount } = query;
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if (toDate && !Number.isNaN(toDate.getTime())) {
    toDate.setHours(23, 59, 59, 999);
  }
  const min = minAmount !== undefined && minAmount !== "" ? parseFloat(minAmount) : null;
  const max = maxAmount !== undefined && maxAmount !== "" ? parseFloat(maxAmount) : null;
  return { fromDate, toDate, min, max };
}

function matchesFillFilters(
  item: { amount: number; createdAt: Date },
  filters: ReturnType<typeof parseFillFilters>
) {
  const { fromDate, toDate, min, max } = filters;
  const t = new Date(item.createdAt).getTime();
  if (fromDate && !Number.isNaN(fromDate.getTime()) && t < fromDate.getTime()) return false;
  if (toDate && !Number.isNaN(toDate.getTime()) && t > toDate.getTime()) return false;
  if (min !== null && !Number.isNaN(min) && item.amount < min) return false;
  if (max !== null && !Number.isNaN(max) && item.amount > max) return false;
  return true;
}

function hasActiveFilters(filters: ReturnType<typeof parseFillFilters>) {
  return (
    Boolean(filters.fromDate && !Number.isNaN(filters.fromDate.getTime())) ||
    Boolean(filters.toDate && !Number.isNaN(filters.toDate.getTime())) ||
    (filters.min !== null && !Number.isNaN(filters.min)) ||
    (filters.max !== null && !Number.isNaN(filters.max))
  );
}

/** Pompacı + yönetici: araç seçimi */
router.get(
  "/lookup",
  requireRoles(UserRole.ADMIN, UserRole.STAFF),
  async (req: AuthRequest, res) => {
    const { q } = req.query as { q?: string };
    const vehicles = await prisma.companyVehicle.findMany({
      where: {
        stationId: req.user!.stationId,
        isActive: true,
        ...(q?.trim()
          ? {
              OR: [
                { name: { contains: q.trim() } },
                { plate: { contains: q.trim() } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, plate: true },
      orderBy: { name: "asc" },
      take: 200,
    });
    res.json({ vehicles });
  }
);

router.get("/", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const { q, active } = req.query as { q?: string; active?: string };
  const filters = parseFillFilters(req.query as Record<string, string | undefined>);
  const filtered = hasActiveFilters(filters);

  const vehicles = await prisma.companyVehicle.findMany({
    where: {
      stationId: req.user!.stationId,
      ...(active === "false" ? { isActive: false } : active === "all" ? {} : { isActive: true }),
      ...(q?.trim()
        ? {
            OR: [
              { name: { contains: q.trim() } },
              { plate: { contains: q.trim() } },
            ],
          }
        : {}),
    },
    include: {
      fills: { select: { amount: true, createdAt: true } },
    },
    orderBy: { name: "asc" },
  });

  const list = vehicles
    .map((v) => {
      const lifetimeTotal = v.fills.reduce((s, f) => s + f.amount, 0);
      const matched = v.fills.filter((f) => matchesFillFilters(f, filters));
      const periodTotal = matched.reduce((s, f) => s + f.amount, 0);
      return {
        id: v.id,
        name: v.name,
        plate: v.plate,
        note: v.note,
        isActive: v.isActive,
        createdAt: v.createdAt,
        totalFuel: filtered ? periodTotal : lifetimeTotal,
        lifetimeTotal,
        fillCount: filtered ? matched.length : v.fills.length,
        matchedCount: matched.length,
      };
    })
    .filter((v) => !filtered || v.matchedCount > 0)
    .sort((a, b) => b.totalFuel - a.totalFuel);

  const summary = {
    vehicleCount: list.length,
    totalFuel: list.reduce((s, v) => s + v.totalFuel, 0),
    lifetimeFuel: list.reduce((s, v) => s + v.lifetimeTotal, 0),
  };

  res.json({ vehicles: list, summary });
});

router.post("/", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  try {
    const { name, plate, note } = req.body as {
      name?: string;
      plate?: string;
      note?: string;
    };

    if (!name?.trim()) {
      res.status(400).json({ error: "Araç adı zorunludur" });
      return;
    }
    if (!plate?.trim()) {
      res.status(400).json({ error: "Plaka zorunludur" });
      return;
    }

    const vehicle = await prisma.companyVehicle.create({
      data: {
        stationId: req.user!.stationId,
        name: name.trim(),
        plate: plate.trim().toUpperCase(),
        note: note?.trim() || null,
      },
    });

    await logAudit(req.user!.userId, "VEHICLE_CREATE", "CompanyVehicle", vehicle.id, {
      name: vehicle.name,
      plate: vehicle.plate,
    });

    res.status(201).json({ vehicle });
  } catch (err) {
    console.error("VEHICLE_CREATE error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Araç kaydedilemedi",
    });
  }
});

router.get("/:id", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const vehicle = await prisma.companyVehicle.findFirst({
    where: { id, stationId: req.user!.stationId },
    include: {
      fills: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!vehicle) {
    res.status(404).json({ error: "Araç bulunamadı" });
    return;
  }

  const filters = parseFillFilters(req.query as Record<string, string | undefined>);
  const lifetimeTotal = vehicle.fills.reduce((s, f) => s + f.amount, 0);
  const fills = vehicle.fills.filter((f) => matchesFillFilters(f, filters));
  const periodTotal = fills.reduce((s, f) => s + f.amount, 0);

  const ledger = fills.map((f) => ({
    id: f.id,
    amount: f.amount,
    label: f.description || "Şirket aracı yakıt",
    transactionId: f.transactionId,
    createdAt: f.createdAt,
  }));

  res.json({
    vehicle: {
      id: vehicle.id,
      name: vehicle.name,
      plate: vehicle.plate,
      note: vehicle.note,
      isActive: vehicle.isActive,
      createdAt: vehicle.createdAt,
    },
    totalFuel: periodTotal,
    lifetimeTotal,
    fillCount: fills.length,
    ledger,
    fills: vehicle.fills,
  });
});

router.patch("/:id", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const { name, plate, note, isActive } = req.body as {
    name?: string;
    plate?: string;
    note?: string;
    isActive?: boolean;
  };

  const existing = await prisma.companyVehicle.findFirst({
    where: { id: routeId(req.params.id), stationId: req.user!.stationId },
  });

  if (!existing) {
    res.status(404).json({ error: "Araç bulunamadı" });
    return;
  }

  if (name !== undefined && !name.trim()) {
    res.status(400).json({ error: "Araç adı boş olamaz" });
    return;
  }
  if (plate !== undefined && !plate.trim()) {
    res.status(400).json({ error: "Plaka boş olamaz" });
    return;
  }

  const vehicle = await prisma.companyVehicle.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(plate !== undefined ? { plate: plate.trim().toUpperCase() } : {}),
      ...(note !== undefined ? { note: note.trim() || null } : {}),
      ...(typeof isActive === "boolean" ? { isActive } : {}),
    },
  });

  await logAudit(req.user!.userId, "VEHICLE_UPDATE", "CompanyVehicle", vehicle.id, {
    name: vehicle.name,
    plate: vehicle.plate,
    isActive: vehicle.isActive,
  });

  res.json({ vehicle });
});

router.post("/:id/fills", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const { amount, description, createdAt } = req.body as {
    amount?: number | string;
    description?: string;
    createdAt?: string;
  };

  const vehicle = await prisma.companyVehicle.findFirst({
    where: { id: routeId(req.params.id), stationId: req.user!.stationId, isActive: true },
  });

  if (!vehicle) {
    res.status(404).json({ error: "Aktif araç bulunamadı" });
    return;
  }

  const value = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!value || value <= 0 || Number.isNaN(value)) {
    res.status(400).json({ error: "Geçerli tutar girin" });
    return;
  }

  const fill = await prisma.vehicleFuelFill.create({
    data: {
      vehicleId: vehicle.id,
      amount: value,
      description: description?.trim() || null,
      createdById: req.user!.userId,
      ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
    },
  });

  await logAudit(req.user!.userId, "VEHICLE_FUEL", "VehicleFuelFill", fill.id, {
    vehicleId: vehicle.id,
    amount: value,
  });

  const fills = await prisma.vehicleFuelFill.findMany({
    where: { vehicleId: vehicle.id },
    select: { amount: true },
  });
  const totalFuel = fills.reduce((s, f) => s + f.amount, 0);

  res.status(201).json({ fill, totalFuel });
});

router.delete("/fills/:id", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const fill = await prisma.vehicleFuelFill.findFirst({
    where: { id: routeId(req.params.id) },
    include: { vehicle: true },
  });

  if (!fill || fill.vehicle.stationId !== req.user!.stationId) {
    res.status(404).json({ error: "Kayıt bulunamadı" });
    return;
  }

  await prisma.vehicleFuelFill.delete({ where: { id: fill.id } });
  await logAudit(req.user!.userId, "VEHICLE_FUEL_DELETE", "VehicleFuelFill", fill.id, {
    vehicleId: fill.vehicleId,
    amount: fill.amount,
  });

  const fills = await prisma.vehicleFuelFill.findMany({
    where: { vehicleId: fill.vehicleId },
    select: { amount: true },
  });
  const totalFuel = fills.reduce((s, f) => s + f.amount, 0);

  res.json({ ok: true, totalFuel });
});

export default router;

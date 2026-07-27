import { Router } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRoles, AuthRequest } from "../middleware/auth.js";
import { logAudit } from "../services/audit.service.js";
import { routeId } from "../lib/route-id.js";

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(UserRole.ADMIN));

function supplierBalance(purchases: { amount: number }[], payments: { amount: number }[]) {
  const totalPurchases = purchases.reduce((s, x) => s + x.amount, 0);
  const totalPayments = payments.reduce((s, x) => s + x.amount, 0);
  return {
    totalPurchases,
    totalPayments,
    balance: totalPurchases - totalPayments,
  };
}

async function getSupplierTotals(supplierId: string) {
  const [purchases, payments] = await Promise.all([
    prisma.expensePurchase.findMany({ where: { supplierId }, select: { amount: true } }),
    prisma.expensePayment.findMany({ where: { supplierId }, select: { amount: true } }),
  ]);
  return supplierBalance(purchases, payments);
}

type LedgerKind = "PURCHASE" | "PAYMENT";

function parseLedgerFilters(query: Record<string, string | undefined>) {
  const { from, to, kind, minAmount, maxAmount } = query;
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if (toDate && !Number.isNaN(toDate.getTime())) {
    toDate.setHours(23, 59, 59, 999);
  }
  const min = minAmount !== undefined && minAmount !== "" ? parseFloat(minAmount) : null;
  const max = maxAmount !== undefined && maxAmount !== "" ? parseFloat(maxAmount) : null;
  const kindFilter =
    kind === "PURCHASE" || kind === "PAYMENT" ? (kind as LedgerKind) : ("all" as const);

  return { fromDate, toDate, kindFilter, min, max };
}

function matchesLedgerFilters(
  item: { amount: number; createdAt: Date; kind: LedgerKind },
  filters: ReturnType<typeof parseLedgerFilters>
) {
  const { fromDate, toDate, kindFilter, min, max } = filters;
  if (kindFilter !== "all" && item.kind !== kindFilter) return false;
  const t = new Date(item.createdAt).getTime();
  if (fromDate && !Number.isNaN(fromDate.getTime()) && t < fromDate.getTime()) return false;
  if (toDate && !Number.isNaN(toDate.getTime()) && t > toDate.getTime()) return false;
  if (min !== null && !Number.isNaN(min) && item.amount < min) return false;
  if (max !== null && !Number.isNaN(max) && item.amount > max) return false;
  return true;
}

router.get("/suppliers", async (req: AuthRequest, res) => {
  const { q, active } = req.query as { q?: string; active?: string };
  const filters = parseLedgerFilters(req.query as Record<string, string | undefined>);
  const hasFilters =
    Boolean(filters.fromDate && !Number.isNaN(filters.fromDate.getTime())) ||
    Boolean(filters.toDate && !Number.isNaN(filters.toDate.getTime())) ||
    filters.kindFilter !== "all" ||
    (filters.min !== null && !Number.isNaN(filters.min)) ||
    (filters.max !== null && !Number.isNaN(filters.max));

  const suppliers = await prisma.supplier.findMany({
    where: {
      stationId: req.user!.stationId,
      ...(active === "false" ? { isActive: false } : active === "all" ? {} : { isActive: true }),
      ...(q?.trim()
        ? {
            OR: [
              { name: { contains: q.trim() } },
              { phone: { contains: q.trim() } },
            ],
          }
        : {}),
    },
    include: {
      purchases: { select: { amount: true, createdAt: true } },
      payments: { select: { amount: true, createdAt: true } },
    },
    orderBy: { name: "asc" },
  });

  const list = suppliers
    .map((s) => {
      const lifetime = supplierBalance(s.purchases, s.payments);
      const filteredPurchases = s.purchases
        .map((p) => ({ ...p, kind: "PURCHASE" as const }))
        .filter((p) => matchesLedgerFilters(p, filters));
      const filteredPayments = s.payments
        .map((p) => ({ ...p, kind: "PAYMENT" as const }))
        .filter((p) => matchesLedgerFilters(p, filters));
      const period = supplierBalance(filteredPurchases, filteredPayments);
      const matchedCount = filteredPurchases.length + filteredPayments.length;
      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        note: s.note,
        isActive: s.isActive,
        createdAt: s.createdAt,
        totalPurchases: hasFilters ? period.totalPurchases : lifetime.totalPurchases,
        totalPayments: hasFilters ? period.totalPayments : lifetime.totalPayments,
        balance: lifetime.balance,
        periodBalance: period.balance,
        matchedCount,
        lifetimePurchases: lifetime.totalPurchases,
        lifetimePayments: lifetime.totalPayments,
      };
    })
    .filter((s) => !hasFilters || s.matchedCount > 0)
    .sort((a, b) => b.balance - a.balance);

  const summary = {
    supplierCount: list.length,
    totalDebt: list.reduce((sum, s) => sum + Math.max(0, s.balance), 0),
    debtors: list.filter((s) => s.balance > 0.01).length,
    periodPurchases: list.reduce((sum, s) => sum + s.totalPurchases, 0),
    periodPayments: list.reduce((sum, s) => sum + s.totalPayments, 0),
  };

  res.json({ suppliers: list, summary });
});

router.post("/suppliers", async (req: AuthRequest, res) => {
  try {
    const { name, phone, note } = req.body as {
      name?: string;
      phone?: string;
      note?: string;
    };

    if (!name?.trim()) {
      res.status(400).json({ error: "Firma adı zorunludur" });
      return;
    }

    const supplier = await prisma.supplier.create({
      data: {
        stationId: req.user!.stationId,
        name: name.trim(),
        phone: phone?.trim() || null,
        note: note?.trim() || null,
      },
    });

    await logAudit(req.user!.userId, "SUPPLIER_CREATE", "Supplier", supplier.id, {
      name: supplier.name,
      phone: supplier.phone,
    });

    res.status(201).json({ supplier });
  } catch (err) {
    console.error("SUPPLIER_CREATE error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Firma kaydedilemedi",
    });
  }
});

router.get("/suppliers/:id", async (req: AuthRequest, res) => {
  const supplier = await prisma.supplier.findFirst({
    where: { id: routeId(req.params.id), stationId: req.user!.stationId },
    include: {
      purchases: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!supplier) {
    res.status(404).json({ error: "Firma bulunamadı" });
    return;
  }

  const lifetime = supplierBalance(supplier.purchases, supplier.payments);
  const filters = parseLedgerFilters(req.query as Record<string, string | undefined>);

  const allLedger = [
    ...supplier.purchases.map((p) => ({
      id: p.id,
      kind: "PURCHASE" as const,
      amount: p.amount,
      label: p.description || "Alış / harcama",
      createdAt: p.createdAt,
    })),
    ...supplier.payments.map((p) => ({
      id: p.id,
      kind: "PAYMENT" as const,
      amount: p.amount,
      label: p.note || "Ödeme",
      createdAt: p.createdAt,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const ledger = allLedger.filter((item) => matchesLedgerFilters(item, filters));
  const filteredPurchases = ledger.filter((x) => x.kind === "PURCHASE");
  const filteredPayments = ledger.filter((x) => x.kind === "PAYMENT");
  const period = supplierBalance(filteredPurchases, filteredPayments);

  res.json({
    supplier: {
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      note: supplier.note,
      isActive: supplier.isActive,
      createdAt: supplier.createdAt,
    },
    totalPurchases: period.totalPurchases,
    totalPayments: period.totalPayments,
    balance: period.balance,
    lifetimeBalance: lifetime.balance,
    lifetimePurchases: lifetime.totalPurchases,
    lifetimePayments: lifetime.totalPayments,
    ledger,
    purchases: supplier.purchases,
    payments: supplier.payments,
  });
});

router.patch("/suppliers/:id", async (req: AuthRequest, res) => {
  const { name, phone, note, isActive } = req.body as {
    name?: string;
    phone?: string;
    note?: string;
    isActive?: boolean;
  };

  const existing = await prisma.supplier.findFirst({
    where: { id: routeId(req.params.id), stationId: req.user!.stationId },
  });

  if (!existing) {
    res.status(404).json({ error: "Firma bulunamadı" });
    return;
  }

  if (name !== undefined && !name.trim()) {
    res.status(400).json({ error: "Firma adı boş olamaz" });
    return;
  }

  const supplier = await prisma.supplier.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(phone !== undefined ? { phone: phone.trim() || null } : {}),
      ...(note !== undefined ? { note: note.trim() || null } : {}),
      ...(typeof isActive === "boolean" ? { isActive } : {}),
    },
  });

  await logAudit(req.user!.userId, "SUPPLIER_UPDATE", "Supplier", supplier.id, {
    name: supplier.name,
    phone: supplier.phone,
    isActive: supplier.isActive,
  });

  res.json({ supplier });
});

router.post("/suppliers/:id/purchases", async (req: AuthRequest, res) => {
  const { amount, description, createdAt } = req.body as {
    amount?: number | string;
    description?: string;
    createdAt?: string;
  };

  const supplier = await prisma.supplier.findFirst({
    where: { id: routeId(req.params.id), stationId: req.user!.stationId, isActive: true },
  });

  if (!supplier) {
    res.status(404).json({ error: "Aktif firma bulunamadı" });
    return;
  }

  const value = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!value || value <= 0 || Number.isNaN(value)) {
    res.status(400).json({ error: "Geçerli tutar girin" });
    return;
  }

  const purchase = await prisma.expensePurchase.create({
    data: {
      supplierId: supplier.id,
      amount: value,
      description: description?.trim() || null,
      createdById: req.user!.userId,
      ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
    },
  });

  await logAudit(req.user!.userId, "EXPENSE_PURCHASE", "ExpensePurchase", purchase.id, {
    supplierId: supplier.id,
    amount: value,
    description: purchase.description,
  });

  const totals = await getSupplierTotals(supplier.id);
  res.status(201).json({ purchase, ...totals });
});

router.post("/suppliers/:id/payments", async (req: AuthRequest, res) => {
  const { amount, note, createdAt } = req.body as {
    amount?: number | string;
    note?: string;
    createdAt?: string;
  };

  const supplier = await prisma.supplier.findFirst({
    where: { id: routeId(req.params.id), stationId: req.user!.stationId },
  });

  if (!supplier) {
    res.status(404).json({ error: "Firma bulunamadı" });
    return;
  }

  const value = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!value || value <= 0 || Number.isNaN(value)) {
    res.status(400).json({ error: "Geçerli tutar girin" });
    return;
  }

  const payment = await prisma.expensePayment.create({
    data: {
      supplierId: supplier.id,
      amount: value,
      note: note?.trim() || null,
      createdById: req.user!.userId,
      ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
    },
  });

  await logAudit(req.user!.userId, "EXPENSE_PAYMENT", "ExpensePayment", payment.id, {
    supplierId: supplier.id,
    amount: value,
    note: payment.note,
  });

  const totals = await getSupplierTotals(supplier.id);
  res.status(201).json({ payment, ...totals });
});

router.delete("/purchases/:id", async (req: AuthRequest, res) => {
  const purchase = await prisma.expensePurchase.findFirst({
    where: { id: routeId(req.params.id) },
    include: { supplier: true },
  });

  if (!purchase || purchase.supplier.stationId !== req.user!.stationId) {
    res.status(404).json({ error: "Kayıt bulunamadı" });
    return;
  }

  await prisma.expensePurchase.delete({ where: { id: purchase.id } });
  await logAudit(req.user!.userId, "EXPENSE_PURCHASE_DELETE", "ExpensePurchase", purchase.id, {
    supplierId: purchase.supplierId,
    amount: purchase.amount,
  });

  const totals = await getSupplierTotals(purchase.supplierId);
  res.json({ ok: true, ...totals });
});

router.delete("/payments/:id", async (req: AuthRequest, res) => {
  const payment = await prisma.expensePayment.findFirst({
    where: { id: routeId(req.params.id) },
    include: { supplier: true },
  });

  if (!payment || payment.supplier.stationId !== req.user!.stationId) {
    res.status(404).json({ error: "Kayıt bulunamadı" });
    return;
  }

  await prisma.expensePayment.delete({ where: { id: payment.id } });
  await logAudit(req.user!.userId, "EXPENSE_PAYMENT_DELETE", "ExpensePayment", payment.id, {
    supplierId: payment.supplierId,
    amount: payment.amount,
  });

  const totals = await getSupplierTotals(payment.supplierId);
  res.json({ ok: true, ...totals });
});

export default router;

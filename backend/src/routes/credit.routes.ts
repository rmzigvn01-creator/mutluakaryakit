import { Router } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRoles, AuthRequest } from "../middleware/auth.js";
import { logAudit } from "../services/audit.service.js";
import { routeId } from "../lib/route-id.js";

const router = Router();

router.use(authMiddleware);

function customerBalance(sales: { amount: number }[], payments: { amount: number }[]) {
  const totalSales = sales.reduce((s, x) => s + x.amount, 0);
  const totalPayments = payments.reduce((s, x) => s + x.amount, 0);
  return {
    totalSales,
    totalPayments,
    balance: totalSales - totalPayments,
  };
}

async function getCustomerTotals(customerId: string) {
  const [sales, payments] = await Promise.all([
    prisma.creditSale.findMany({ where: { customerId }, select: { amount: true } }),
    prisma.creditPayment.findMany({ where: { customerId }, select: { amount: true } }),
  ]);
  return customerBalance(sales, payments);
}

type CreditLedgerKind = "SALE" | "PAYMENT";

function parseCreditLedgerFilters(query: Record<string, string | undefined>) {
  const { from, to, kind, minAmount, maxAmount } = query;
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if (toDate && !Number.isNaN(toDate.getTime())) {
    toDate.setHours(23, 59, 59, 999);
  }
  const min = minAmount !== undefined && minAmount !== "" ? parseFloat(minAmount) : null;
  const max = maxAmount !== undefined && maxAmount !== "" ? parseFloat(maxAmount) : null;
  const kindFilter =
    kind === "SALE" || kind === "PAYMENT" ? (kind as CreditLedgerKind) : ("all" as const);

  return { fromDate, toDate, kindFilter, min, max };
}

function matchesCreditLedgerFilters(
  item: { amount: number; createdAt: Date; kind: CreditLedgerKind },
  filters: ReturnType<typeof parseCreditLedgerFilters>
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

/** Pompacı + yönetici: sadece müşteri seçimi (borç/bakiye yok) */
async function lookupCustomers(req: AuthRequest, res: import("express").Response) {
  const { q } = req.query as { q?: string };

  const customers = await prisma.customer.findMany({
    where: {
      stationId: req.user!.stationId,
      isActive: true,
      ...(q?.trim()
        ? {
            OR: [
              { name: { contains: q.trim() } },
              { phone: { contains: q.trim() } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, phone: true },
    orderBy: { name: "asc" },
    take: 200,
  });

  res.json({ customers });
}

router.get("/lookup", requireRoles(UserRole.ADMIN, UserRole.STAFF), lookupCustomers);
/** :id rotasından önce — eski istemciler için */
router.get("/customers/lookup", requireRoles(UserRole.ADMIN, UserRole.STAFF), lookupCustomers);

/** Yönetici: borç özetli liste */
router.get("/customers", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const { q, active } = req.query as { q?: string; active?: string };
  const filters = parseCreditLedgerFilters(req.query as Record<string, string | undefined>);
  const hasFilters =
    Boolean(filters.fromDate && !Number.isNaN(filters.fromDate.getTime())) ||
    Boolean(filters.toDate && !Number.isNaN(filters.toDate.getTime())) ||
    filters.kindFilter !== "all" ||
    (filters.min !== null && !Number.isNaN(filters.min)) ||
    (filters.max !== null && !Number.isNaN(filters.max));

  const customers = await prisma.customer.findMany({
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
      sales: { select: { amount: true, createdAt: true } },
      payments: { select: { amount: true, createdAt: true } },
    },
    orderBy: { name: "asc" },
  });

  const list = customers
    .map((c) => {
      const lifetime = customerBalance(c.sales, c.payments);
      const filteredSales = c.sales
        .map((s) => ({ ...s, kind: "SALE" as const }))
        .filter((s) => matchesCreditLedgerFilters(s, filters));
      const filteredPayments = c.payments
        .map((p) => ({ ...p, kind: "PAYMENT" as const }))
        .filter((p) => matchesCreditLedgerFilters(p, filters));
      const period = customerBalance(filteredSales, filteredPayments);
      const matchedCount = filteredSales.length + filteredPayments.length;
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        note: c.note,
        isActive: c.isActive,
        createdAt: c.createdAt,
        totalSales: hasFilters ? period.totalSales : lifetime.totalSales,
        totalPayments: hasFilters ? period.totalPayments : lifetime.totalPayments,
        balance: lifetime.balance,
        periodBalance: period.balance,
        matchedCount,
        lifetimeSales: lifetime.totalSales,
        lifetimePayments: lifetime.totalPayments,
      };
    })
    .filter((c) => !hasFilters || c.matchedCount > 0)
    .sort((a, b) => b.balance - a.balance);

  const summary = {
    customerCount: list.length,
    totalDebt: list.reduce((s, c) => s + Math.max(0, c.balance), 0),
    debtors: list.filter((c) => c.balance > 0.01).length,
    periodSales: list.reduce((s, c) => s + c.totalSales, 0),
    periodPayments: list.reduce((s, c) => s + c.totalPayments, 0),
  };

  res.json({ customers: list, summary });
});

router.post("/customers", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  try {
    const { name, phone, note } = req.body as {
      name?: string;
      phone?: string;
      note?: string;
    };

    if (!name?.trim()) {
      res.status(400).json({ error: "Müşteri adı zorunludur" });
      return;
    }

    const customer = await prisma.customer.create({
      data: {
        stationId: req.user!.stationId,
        name: name.trim(),
        phone: phone?.trim() || null,
        note: note?.trim() || null,
      },
    });

    await logAudit(req.user!.userId, "CUSTOMER_CREATE", "Customer", customer.id, {
      name: customer.name,
      phone: customer.phone,
    });

    res.status(201).json({ customer });
  } catch (err) {
    console.error("CUSTOMER_CREATE error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Müşteri kaydedilemedi",
    });
  }
});

router.get("/customers/:id", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const customer = await prisma.customer.findFirst({
    where: { id: routeId(req.params.id), stationId: req.user!.stationId },
    include: {
      sales: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!customer) {
    res.status(404).json({ error: "Müşteri bulunamadı" });
    return;
  }

  const lifetime = customerBalance(customer.sales, customer.payments);
  const filters = parseCreditLedgerFilters(req.query as Record<string, string | undefined>);

  const allLedger = [
    ...customer.sales.map((s) => ({
      id: s.id,
      kind: "SALE" as const,
      amount: s.amount,
      label: s.description || "Veresiye satış",
      createdAt: s.createdAt,
    })),
    ...customer.payments.map((p) => ({
      id: p.id,
      kind: "PAYMENT" as const,
      amount: p.amount,
      label: p.note || "Tahsilat",
      createdAt: p.createdAt,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const ledger = allLedger.filter((item) => matchesCreditLedgerFilters(item, filters));
  const filteredSales = ledger.filter((x) => x.kind === "SALE");
  const filteredPayments = ledger.filter((x) => x.kind === "PAYMENT");
  const period = customerBalance(filteredSales, filteredPayments);

  res.json({
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      note: customer.note,
      isActive: customer.isActive,
      createdAt: customer.createdAt,
    },
    totalSales: period.totalSales,
    totalPayments: period.totalPayments,
    balance: period.balance,
    lifetimeBalance: lifetime.balance,
    lifetimeSales: lifetime.totalSales,
    lifetimePayments: lifetime.totalPayments,
    ledger,
    sales: customer.sales,
    payments: customer.payments,
  });
});

router.patch("/customers/:id", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const { name, phone, note, isActive } = req.body as {
    name?: string;
    phone?: string;
    note?: string;
    isActive?: boolean;
  };

  const existing = await prisma.customer.findFirst({
    where: { id: routeId(req.params.id), stationId: req.user!.stationId },
  });

  if (!existing) {
    res.status(404).json({ error: "Müşteri bulunamadı" });
    return;
  }

  if (name !== undefined && !name.trim()) {
    res.status(400).json({ error: "Müşteri adı boş olamaz" });
    return;
  }

  const customer = await prisma.customer.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(phone !== undefined ? { phone: phone.trim() || null } : {}),
      ...(note !== undefined ? { note: note.trim() || null } : {}),
      ...(typeof isActive === "boolean" ? { isActive } : {}),
    },
  });

  await logAudit(req.user!.userId, "CUSTOMER_UPDATE", "Customer", customer.id, {
    name: customer.name,
    phone: customer.phone,
    isActive: customer.isActive,
  });

  res.json({ customer });
});

/** Manuel borç ekleme — sadece yönetici (pompacı yeni işlemden yazar) */
router.post("/customers/:id/sales", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const { amount, description, createdAt } = req.body as {
    amount?: number | string;
    description?: string;
    createdAt?: string;
  };

  const customer = await prisma.customer.findFirst({
    where: { id: routeId(req.params.id), stationId: req.user!.stationId, isActive: true },
  });

  if (!customer) {
    res.status(404).json({ error: "Aktif müşteri bulunamadı" });
    return;
  }

  const value = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!value || value <= 0 || Number.isNaN(value)) {
    res.status(400).json({ error: "Geçerli tutar girin" });
    return;
  }

  const sale = await prisma.creditSale.create({
    data: {
      customerId: customer.id,
      amount: value,
      description: description?.trim() || null,
      createdById: req.user!.userId,
      ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
    },
  });

  await logAudit(req.user!.userId, "CREDIT_SALE", "CreditSale", sale.id, {
    customerId: customer.id,
    amount: value,
    description: sale.description,
  });

  const totals = await getCustomerTotals(customer.id);
  res.status(201).json({ sale, ...totals });
});

router.post("/customers/:id/payments", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const { amount, note, createdAt } = req.body as {
    amount?: number | string;
    note?: string;
    createdAt?: string;
  };

  const customer = await prisma.customer.findFirst({
    where: { id: routeId(req.params.id), stationId: req.user!.stationId },
  });

  if (!customer) {
    res.status(404).json({ error: "Müşteri bulunamadı" });
    return;
  }

  const value = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!value || value <= 0 || Number.isNaN(value)) {
    res.status(400).json({ error: "Geçerli tutar girin" });
    return;
  }

  const payment = await prisma.creditPayment.create({
    data: {
      customerId: customer.id,
      amount: value,
      note: note?.trim() || null,
      createdById: req.user!.userId,
      ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
    },
  });

  await logAudit(req.user!.userId, "CREDIT_PAYMENT", "CreditPayment", payment.id, {
    customerId: customer.id,
    amount: value,
    note: payment.note,
  });

  const totals = await getCustomerTotals(customer.id);
  res.status(201).json({ payment, ...totals });
});

router.delete("/sales/:id", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const sale = await prisma.creditSale.findFirst({
    where: { id: routeId(req.params.id) },
    include: { customer: true },
  });

  if (!sale || sale.customer.stationId !== req.user!.stationId) {
    res.status(404).json({ error: "Kayıt bulunamadı" });
    return;
  }

  await prisma.creditSale.delete({ where: { id: sale.id } });
  await logAudit(req.user!.userId, "CREDIT_SALE_DELETE", "CreditSale", sale.id, {
    customerId: sale.customerId,
    amount: sale.amount,
  });

  const totals = await getCustomerTotals(sale.customerId);
  res.json({ ok: true, ...totals });
});

router.delete("/payments/:id", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const payment = await prisma.creditPayment.findFirst({
    where: { id: routeId(req.params.id) },
    include: { customer: true },
  });

  if (!payment || payment.customer.stationId !== req.user!.stationId) {
    res.status(404).json({ error: "Kayıt bulunamadı" });
    return;
  }

  await prisma.creditPayment.delete({ where: { id: payment.id } });
  await logAudit(req.user!.userId, "CREDIT_PAYMENT_DELETE", "CreditPayment", payment.id, {
    customerId: payment.customerId,
    amount: payment.amount,
  });

  const totals = await getCustomerTotals(payment.customerId);
  res.json({ ok: true, ...totals });
});

export default router;

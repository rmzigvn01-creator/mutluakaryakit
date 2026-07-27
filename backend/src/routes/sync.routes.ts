import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";
import { sanitizeTransactionsForRole } from "../lib/roles.js";

const router = Router();

router.use(authMiddleware);

// Toplu senkron — offline kuyruktan gelen işlemler
router.post("/batch", async (req: AuthRequest, res) => {
  const { transactions } = req.body as {
    transactions?: Array<{
      clientId: string;
      type: string;
      enteredAmount: number;
      description?: string;
      deviceInfo?: string;
      createdAt?: string;
      receiptBase64?: string;
    }>;
  };

  if (!Array.isArray(transactions) || transactions.length === 0) {
    res.status(400).json({ error: "transactions dizisi gerekli" });
    return;
  }

  const results: Array<{ clientId: string; status: string; transactionId?: string; error?: string }> = [];

  for (const item of transactions) {
    try {
      const existing = await prisma.transaction.findUnique({
        where: { clientId: item.clientId },
      });

      if (existing) {
        results.push({ clientId: item.clientId, status: "duplicate", transactionId: existing.id });
        continue;
      }

      // Fiş base64 batch'te ayrı upload endpoint'i ile gönderilmeli
      // MVP: metadata senkron, fiş ayrı POST /transactions ile
      results.push({
        clientId: item.clientId,
        status: "pending_receipt",
        error: "Fiş fotoğrafını /transactions endpoint ile yükleyin",
      });
    } catch (err) {
      results.push({
        clientId: item.clientId,
        status: "failed",
        error: err instanceof Error ? err.message : "Bilinmeyen hata",
      });
    }
  }

  res.json({ results });
});

// Sunucudan istemciye çek — son senkron sonrası değişiklikler
router.get("/pull", async (req: AuthRequest, res) => {
  const { since } = req.query as { since?: string };

  const sinceDate = since ? new Date(since) : new Date(0);

  const transactions = await prisma.transaction.findMany({
    where: {
      stationId: req.user!.stationId,
      updatedAt: { gt: sinceDate },
      ...(req.user!.role === "STAFF" ? { createdById: req.user!.userId } : {}),
    },
    include: {
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  const corrections = await prisma.correctionRequest.findMany({
    where: {
      transaction: { stationId: req.user!.stationId },
      createdAt: { gt: sinceDate },
    },
    include: {
      transaction: { select: { id: true, clientId: true } },
    },
  });

  res.json({
    syncedAt: new Date().toISOString(),
    transactions: sanitizeTransactionsForRole(transactions, req.user!.role),
    corrections,
  });
});

export default router;

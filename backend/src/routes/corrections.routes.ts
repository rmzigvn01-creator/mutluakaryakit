import { Router } from "express";
import { CorrectionStatus, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRoles, AuthRequest } from "../middleware/auth.js";
import { logAudit } from "../services/audit.service.js";
import { routeId } from "../lib/route-id.js";

const router = Router();

router.use(authMiddleware);

router.get("/", async (req: AuthRequest, res) => {
  const { status = "PENDING" } = req.query as { status?: string };

  const where: Record<string, unknown> = {
    status: status as CorrectionStatus,
    transaction: { stationId: req.user!.stationId },
  };

  if (req.user!.role === UserRole.STAFF) {
    where.requestedById = req.user!.userId;
  }

  const requests = await prisma.correctionRequest.findMany({
    where,
    include: {
      transaction: {
        include: { createdBy: { select: { id: true, name: true } } },
      },
      requestedBy: { select: { id: true, name: true, role: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ requests });
});

router.post(
  "/:id/review",
  requireRoles(UserRole.ADMIN),
  async (req: AuthRequest, res) => {
    const { action, note } = req.body as { action?: string; note?: string };

    if (!action || !["APPROVE", "REJECT"].includes(action)) {
      res.status(400).json({ error: "action: APPROVE veya REJECT gerekli" });
      return;
    }

    const request = await prisma.correctionRequest.findFirst({
      where: {
        id: routeId(req.params.id),
        status: CorrectionStatus.PENDING,
        transaction: { stationId: req.user!.stationId },
      },
      include: { transaction: true },
    });

    if (!request) {
      res.status(404).json({ error: "Bekleyen talep bulunamadı" });
      return;
    }

    if (action === "REJECT") {
      const updated = await prisma.correctionRequest.update({
        where: { id: request.id },
        data: {
          status: CorrectionStatus.REJECTED,
          reviewedById: req.user!.userId,
          reviewedAt: new Date(),
        },
      });

      await logAudit(req.user!.userId, "CORRECTION_REJECT", "CorrectionRequest", request.id, {
        note,
      });

      res.json({ request: updated });
      return;
    }

    // APPROVE
    const result = await prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.correctionRequest.update({
        where: { id: request.id },
        data: {
          status: CorrectionStatus.APPROVED,
          reviewedById: req.user!.userId,
          reviewedAt: new Date(),
        },
      });

      if (request.type === "DELETE") {
        await tx.transaction.update({
          where: { id: request.transactionId },
          data: { isDeleted: true },
        });
      } else if (request.newValues) {
        const newVals = JSON.parse(request.newValues) as Record<string, unknown>;
        await tx.transaction.update({
          where: { id: request.transactionId },
          data: {
            ...(newVals.enteredAmount !== undefined
              ? { enteredAmount: Number(newVals.enteredAmount) }
              : {}),
            ...(newVals.type !== undefined ? { type: newVals.type as never } : {}),
            ...(newVals.description !== undefined
              ? { description: String(newVals.description) }
              : {}),
          },
        });
      }

      return updatedRequest;
    });

    await logAudit(req.user!.userId, "CORRECTION_APPROVE", "CorrectionRequest", request.id, {
      type: request.type,
      note,
    });

    res.json({ request: result });
  }
);

export default router;

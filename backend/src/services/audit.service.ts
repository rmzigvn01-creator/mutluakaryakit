import { prisma } from "../lib/prisma.js";

export async function logAudit(
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>
) {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      entityType,
      entityId,
      details: JSON.stringify(details),
    },
  });
}

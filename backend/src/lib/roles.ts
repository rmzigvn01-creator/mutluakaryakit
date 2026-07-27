import { UserRole, SuspicionStatus } from "@prisma/client";

type TransactionLike = {
  suspicionStatus: SuspicionStatus;
  receiptAmount?: number | null;
  receiptDateTime?: Date | null;
  amountDiff?: number | null;
  suspicionNote?: string | null;
  reviewedById?: string | null;
  reviewedAt?: Date | null;
  [key: string]: unknown;
};

/** Personel ve muhasebeci şüpheli işlem bilgisini asla görmez */
export function sanitizeTransactionForRole<T extends TransactionLike>(
  transaction: T,
  role: UserRole
): T {
  // Asla JSON'a binary fiş gövdesi basma (liste/detay şişer)
  const { receiptData: _omit, ...withoutData } = transaction as T & {
    receiptData?: unknown;
  };

  if (role === UserRole.ADMIN) {
    return withoutData as T;
  }

  return {
    ...withoutData,
    suspicionStatus: SuspicionStatus.NORMAL,
    receiptAmount: null,
    receiptDateTime: null,
    receiptPath: null,
    amountDiff: null,
    suspicionNote: null,
    reviewedById: null,
    reviewedAt: null,
  } as unknown as T;
}

export function sanitizeTransactionsForRole<T extends TransactionLike>(
  transactions: T[],
  role: UserRole
): T[] {
  return transactions.map((t) => sanitizeTransactionForRole(t, role));
}

export function sanitizeShiftSummaryForRole(
  summary: {
    transactionCount: number;
    totalAmount: number;
    suspiciousCount: number;
    averageAmount: number;
    byType: Record<string, { count: number; total: number }>;
  },
  role: UserRole
) {
  if (role === UserRole.ADMIN) return summary;
  return { ...summary, suspiciousCount: 0 };
}

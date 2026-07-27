import { SuspicionStatus, TransactionType, UserRole } from "@prisma/client";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";

const TYPE_LABELS: Record<TransactionType, string> = {
  FUEL_BENZIN: "Benzin",
  FUEL_MOTORIN: "Motorin",
  CARD_POS: "Kart (POS)",
  CASH: "Nakit",
  OTHER: "Diğer",
};

function fmtMoney(n: number): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function isPushConfigured(): boolean {
  return Boolean(config.fcmServerKey);
}

async function sendFcmPush(
  token: string,
  title: string,
  body: string,
  data: Record<string, string>
): Promise<boolean> {
  if (!isPushConfigured()) return false;

  try {
    const res = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        Authorization: `key=${config.fcmServerKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: token,
        notification: { title, body, sound: "default" },
        data,
        priority: "high",
        content_available: true,
      }),
    });

    const result = (await res.json()) as { success?: number; failure?: number };
    return res.ok && (result.success ?? 0) > 0;
  } catch (err) {
    console.error("FCM gönderim hatası:", err);
    return false;
  }
}

async function getStationAdmins(stationId: string) {
  return prisma.user.findMany({
    where: { stationId, role: UserRole.ADMIN },
    select: { id: true, name: true },
  });
}

export async function notifyAdminsSuspiciousTransaction(transaction: {
  id: string;
  stationId: string;
  type: TransactionType;
  enteredAmount: number;
  receiptAmount: number | null;
  amountDiff: number | null;
  suspicionStatus: SuspicionStatus;
  createdBy: { name: string };
}): Promise<void> {
  if (
    transaction.suspicionStatus !== SuspicionStatus.SUSPICIOUS_MISMATCH &&
    transaction.suspicionStatus !== SuspicionStatus.SUSPICIOUS_DATETIME_MISMATCH &&
    transaction.suspicionStatus !== SuspicionStatus.SUSPICIOUS_UNREADABLE
  ) {
    return;
  }

  const typeLabel = TYPE_LABELS[transaction.type] ?? transaction.type;
  const isMismatch = transaction.suspicionStatus === SuspicionStatus.SUSPICIOUS_MISMATCH;
  const isDateTime = transaction.suspicionStatus === SuspicionStatus.SUSPICIOUS_DATETIME_MISMATCH;

  const title = isMismatch
    ? "⚠️ Şüpheli İşlem"
    : isDateTime
      ? "⚠️ Fiş Tarih/Saat Uyuşmuyor"
      : "⚠️ Fiş Okunamadı";
  const body = isMismatch
    ? `${transaction.createdBy.name}: ${fmtMoney(transaction.enteredAmount)} TL girildi, fiş ${fmtMoney(transaction.receiptAmount ?? 0)} TL`
    : isDateTime
      ? `${transaction.createdBy.name}: ${fmtMoney(transaction.enteredAmount)} TL — fiş tarih/saat kayıtla uyuşmuyor`
      : `${transaction.createdBy.name}: ${fmtMoney(transaction.enteredAmount)} TL — fiş kontrol edin`;

  const data = {
    type: "suspicious_transaction",
    transactionId: transaction.id,
    staffName: transaction.createdBy.name,
    enteredAmount: String(transaction.enteredAmount),
    receiptAmount: String(transaction.receiptAmount ?? ""),
    transactionType: typeLabel,
  };

  const admins = await getStationAdmins(transaction.stationId);

  for (const admin of admins) {
    await prisma.appNotification.create({
      data: {
        userId: admin.id,
        title,
        body,
        data: JSON.stringify(data),
      },
    });

    const devices = await prisma.pushDevice.findMany({
      where: { userId: admin.id },
    });

    for (const device of devices) {
      void sendFcmPush(device.token, title, body, data);
    }
  }
}

export async function sendTestPushToUser(userId: string): Promise<{ sent: number; devices: number }> {
  const devices = await prisma.pushDevice.findMany({ where: { userId } });
  let sent = 0;

  for (const device of devices) {
    const ok = await sendFcmPush(
      device.token,
      "✅ Mutlu Akaryakıt",
      "Push bildirimleri çalışıyor. Şüpheli işlemlerde uyarı alacaksınız.",
      { type: "test" }
    );
    if (ok) sent++;
  }

  return { sent, devices: devices.length };
}

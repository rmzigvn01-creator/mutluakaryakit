import { SuspicionStatus } from "@prisma/client";
import Tesseract from "tesseract.js";
import { config } from "../lib/config.js";

const ISTANBUL_TZ = "Europe/Istanbul";

export type FuelKind = "MOTORIN" | "BENZIN" | "LPG" | "UNKNOWN";

export type ReceiptExtraction = {
  amount: number | null;
  dateTime: Date | null;
  /** YYYY-MM-DD (kırmızı alan) */
  date: string | null;
  /** HH:mm (turuncu alan) */
  time: string | null;
  text: string;
  /** Fiş no (mavi alan) */
  receiptNo: string | null;
  /** Litre (yeşil alan) */
  liters: number | null;
  /** MOT.VMAX / benzin / otogaz (litrenin altı) */
  fuelKind: FuelKind;
  plate: string | null;
  unitPrice: number | null;
};

export function isSuspiciousStatus(status: SuspicionStatus): boolean {
  return (
    status === SuspicionStatus.SUSPICIOUS_MISMATCH ||
    status === SuspicionStatus.SUSPICIOUS_DATETIME_MISMATCH ||
    status === SuspicionStatus.SUSPICIOUS_UNREADABLE
  );
}

/** Türkçe para: 1.000,00 | *1.000,00 | 42,44 | 1000.00 */
export function parseTrMoney(raw: string): number | null {
  let s = raw.replace(/\s/g, "").replace(/^[*\-–—]+/, "");
  if (!s) return null;

  // OCR: 4.309.74 (nokta hem binlik hem ondalık sanılmış) → 4.309,74
  if (/^\d{1,3}(\.\d{3})+\.\d{2}$/.test(s)) {
    s = s.replace(/\.(\d{2})$/, ",$1");
  }
  // OCR: 4.30974 (virgül kaybolmuş) → 4.309,74
  if (/^\d{1,3}(\.\d{3})+\d{2}$/.test(s) && !s.includes(",")) {
    s = s.replace(/(\d{2})$/, ",$1");
  }

  // 1.000,00 veya 12.345,67
  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(s)) {
    const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  // 1000,00 veya 42,44
  if (/^\d+,\d{2}$/.test(s)) {
    const n = parseFloat(s.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  // 1000.00 (US) — ama 430974.00 genelde TR virgül kaybı
  if (/^\d+\.\d{2}$/.test(s)) {
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return null;
    // 5+ basamaklı *.00 → kuruş birleşmiş olabilir (430974.00 → 4309.74)
    if (n >= 10000 && /^\d{5,}\.00$/.test(s)) return n / 100;
    return n;
  }
  // 1000 veya OCR: 430974 (virgül/nokta tamamen kayıp)
  if (/^\d+$/.test(s)) {
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return null;
    // 5–7 haneli tamsayı → son 2 hane kuruş (430974 → 4309.74)
    if (s.length >= 5 && s.length <= 7 && n >= 10000) return n / 100;
    return n;
  }
  return null;
}

const MONEY_CAPTURE =
  "(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{2}|\\.\\d{2}|\\d{2})|\\d{1,3}(?:\\.\\d{3})+,\\d{2}|\\d+[.,]\\d{2}|\\d{4,7})";

/**
 * Litre × birim fiyattan tutar (OCR TOPLAM bozulunca yedek).
 */
export function amountFromLitersAndPrice(
  liters: number | null,
  unitPrice: number | null
): number | null {
  if (liters == null || unitPrice == null) return null;
  if (liters <= 0 || unitPrice <= 0) return null;
  return Math.round(liters * unitPrice * 100) / 100;
}

/**
 * OCR bozuk tutarı düzelt: litre×fiyat ile çapraz kontrol.
 */
export function refineReceiptAmount(
  amount: number | null,
  liters: number | null,
  unitPrice: number | null
): number | null {
  const computed = amountFromLitersAndPrice(liters, unitPrice);

  // Yakıt fişlerinde LT × birim fiyat en güvenilir kaynak
  if (computed != null) {
    if (amount == null) return computed;
    if (Math.abs(amount - computed) <= 1) return computed;
    if (Math.abs(amount / 100 - computed) <= 1) return computed;
    return computed;
  }

  if (amount != null && amount >= 10000 && Number.isInteger(amount)) {
    return amount / 100;
  }
  return amount;
}

/**
 * Sarı alan — TOPLAM tutarı.
 * Örn: TOPLAM *1.000,00 · TOPLAM: 1.000,00 · NAKİT *1.000,00
 */
export function parseAmountFromText(text: string): number | null {
  const normalized = text.replace(/\s+/g, " ");

  const priorityPatterns = [
    // TOPLAM / OCR bozulmaları: TOPLAN, TOFLAM, T0PLAM, fn (nadiren)
    new RegExp(
      `(?:TOPLAM|TOPLAN|TOFLAM|T0PLAM|GENEL\\s*TOPLAM)\\s*[:*]?\\s*\\*?${MONEY_CAPTURE}`,
      "gi"
    ),
    new RegExp(`(?:NAKIT|NAKİT|NAKİT)\\s*[:*]?\\s*\\*?${MONEY_CAPTURE}`, "gi"),
    new RegExp(`(?:TUTAR|AMOUNT)\\s*[:*]?\\s*\\*?${MONEY_CAPTURE}`, "gi"),
  ];

  for (const pattern of priorityPatterns) {
    const matches = [...normalized.matchAll(pattern)];
    if (matches.length === 0) continue;
    for (let i = matches.length - 1; i >= 0; i--) {
      const n = parseTrMoney(matches[i][1]);
      // 500_000 üstü ham değer; parseTrMoney zaten /100 yapmış olabilir
      if (n !== null && n > 0 && n < 200000) return n;
    }
  }

  // LT X fiyat satırının sağındaki tutar: 84,15 LT X 51,22 *4.309,74
  const lineTotal = normalized.match(
    new RegExp(
      `\\d{1,4}[.,]\\d{1,3}\\s*(?:LT|LITRE)?\\s*[xX×*]\\s*\\d{1,4}[.,]\\d{1,3}\\s*\\*?${MONEY_CAPTURE}`,
      "i"
    )
  );
  if (lineTotal?.[1]) {
    const n = parseTrMoney(lineTotal[1]);
    if (n !== null && n >= 20 && n < 200000) return n;
  }

  const loose = [...normalized.matchAll(new RegExp(`\\*?${MONEY_CAPTURE}`, "g"))]
    .map((m) => parseTrMoney(m[1]))
    .filter((n): n is number => n !== null && n >= 20 && n < 200000);

  if (loose.length === 0) return null;
  // En büyük makul tutar (KDV değil TOPLAM)
  return Math.max(...loose);
}

function normalizeYear(year: number): number {
  if (year < 100) return 2000 + year;
  return year;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function buildIstanbulDateTime(
  day: number,
  month: number,
  year: number,
  hour: number,
  minute: number
): Date | null {
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const y = normalizeYear(year);
  const iso = `${y}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00+03:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

type DateParts = { day: number; month: number; year: number };
type TimeParts = { hour: number; minute: number };

/**
 * Kırmızı alan — tarih.
 * Petrol Ofisi: 03-02-2024 (FİŞ NO satırının üstü)
 */
export function parseDateParts(text: string): DateParts | null {
  const normalized = text.replace(/\s+/g, " ");

  const candidates: DateParts[] = [];

  const pushIfValid = (day: number, month: number, year: number) => {
    const y = normalizeYear(year);
    if (day < 1 || day > 31 || month < 1 || month > 12) return;
    if (y < 2020 || y > 2100) return;
    candidates.push({ day, month, year: y });
  };

  // Fiş no civarındaki tarihi önceliklendir
  const nearFis = normalized.match(
    /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\s+(\d{1,2})[:.](\d{2})[^\n]{0,60}F[Iİıi]?[SŞşs]\s*NO/i
  );
  if (nearFis) {
    pushIfValid(parseInt(nearFis[1], 10), parseInt(nearFis[2], 10), parseInt(nearFis[3], 10));
  }

  const nearFis2 = normalized.match(
    /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})[^\n]{0,40}F[Iİıi]?[SŞşs]\s*NO/i
  );
  if (nearFis2) {
    pushIfValid(parseInt(nearFis2[1], 10), parseInt(nearFis2[2], 10), parseInt(nearFis2[3], 10));
  }

  const fisNearDate = normalized.match(
    /F[Iİıi]?[SŞşs]\s*NO[^\n]{0,20}(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/i
  );
  if (fisNearDate) {
    pushIfValid(
      parseInt(fisNearDate[1], 10),
      parseInt(fisNearDate[2], 10),
      parseInt(fisNearDate[3], 10)
    );
  }

  // Saat ile aynı satır: 11-07-2025 01:09
  for (const m of normalized.matchAll(
    /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\s+(\d{1,2})[:.](\d{2})/g
  )) {
    pushIfValid(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  }

  for (const m of normalized.matchAll(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/g)) {
    pushIfValid(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  }

  for (const m of normalized.matchAll(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/g)) {
    pushIfValid(parseInt(m[3], 10), parseInt(m[2], 10), parseInt(m[1], 10));
  }

  if (!candidates.length) return null;
  // Lisans/MERSİS numaralarından gelen saçma adaylar elendi; ilk geçerliyi al
  return candidates[0];
}

/**
 * Turuncu alan — saat.
 * Petrol Ofisi: tarih satırının sağında 17:47
 */
export function parseTimeParts(text: string): TimeParts | null {
  const normalized = text.replace(/\s+/g, " ");

  const nearDate = normalized.match(
    /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\s+(\d{1,2})[:.](\d{2})/
  );
  if (nearDate) {
    const hour = parseInt(nearDate[4], 10);
    const minute = parseInt(nearDate[5], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  const patterns = [
    /(?:SAAT|TIME)[:\s]*(\d{1,2})[:.](\d{2})/gi,
    /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g,
  ];

  for (const pattern of patterns) {
    const matches = [...normalized.matchAll(pattern)];
    if (matches.length === 0) continue;
    const m = matches[0];
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  return null;
}

export function formatDateField(parts: DateParts): string {
  return `${normalizeYear(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function formatTimeField(parts: TimeParts): string {
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** Fiş metninden tarih + saat çıkarır */
export function parseDateTimeFromText(text: string): Date | null {
  const dateParts = parseDateParts(text);
  const timeParts = parseTimeParts(text);
  if (!dateParts || !timeParts) return null;

  return buildIstanbulDateTime(
    dateParts.day,
    dateParts.month,
    dateParts.year,
    timeParts.hour,
    timeParts.minute
  );
}

function isPlausibleReceiptDate(parsed: Date, referenceDate: Date): boolean {
  const y = parsed.getFullYear();
  if (y < 2020 || y > 2100) return false;
  // Gelecek: en fazla 1 gün; geçmiş: 3 yıla kadar (geç girilen fişler)
  const diffMs = parsed.getTime() - referenceDate.getTime();
  const diffDays = diffMs / 86_400_000;
  if (diffDays > 1) return false;
  if (diffDays < -366 * 3) return false;
  return true;
}

/** Fişte geçerli tarih+saat varsa kullanır; yoksa null (bugüne yapıştırmaz). */
export function resolveReceiptDateTime(
  _text: string,
  referenceDate: Date,
  parsedDateTime: Date | null
): Date | null {
  if (parsedDateTime && isPlausibleReceiptDate(parsedDateTime, referenceDate)) {
    return parsedDateTime;
  }

  // Tarih fişten çıkmadıysa / saçma lisans no'ya takıldıysa → null.
  // Eski davranış (bugün + fiş saati) OCR'nin "27 Temmuz 2026 okudu" sanılmasına yol açıyordu.
  return null;
}

/** Mavi alan — Fiş no. Örn: FİŞ NO: 0222 */
export function parseReceiptNoFromText(text: string): string | null {
  const patterns = [
    /F[Iİıi]?[SŞşs]\s*NO[:\s.]*([0-9]{1,8})/i,
    /FIS\s*NO[:\s.]*([0-9]{1,8})/i,
    /F[Iİıi]?[SŞşs]\s*N[O0][:\s.]*([0-9]{1,8})/i,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * Yeşil alan — litre.
 * Örn: 23,560 LT · 23,560 LT X 42,44
 */
export function parseLitersFromText(text: string): number | null {
  const normalized = text.replace(/\s+/g, " ");
  const patterns = [
    /(\d{1,4}[.,]\d{1,3})\s*(?:LT|LITRE)\b/gi,
    /(\d{1,4}[.,]\d{1,3})\s*[xX×*]\s*\d/gi,
  ];

  for (const pattern of patterns) {
    const matches = [...normalized.matchAll(pattern)];
    if (!matches.length) continue;
    const raw = matches[0][1].replace(",", ".");
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n > 0 && n < 500) return n;
  }
  return null;
}

/** Birim fiyat — örn: 23,560 LT X 42,44 */
export function parseUnitPriceFromText(text: string): number | null {
  const normalized = text.replace(/\s+/g, " ");
  const patterns = [
    /(\d{1,4}[.,]\d{1,3})\s*(?:LT|LITRE)?\s*[xX×*]\s*(\d{1,4}[.,]\d{1,3})/gi,
    /(?:BIRIM|FIYAT|UNIT)[:\s]*(\d{1,4}[.,]\d{1,3})/gi,
  ];

  for (const pattern of patterns) {
    const matches = [...normalized.matchAll(pattern)];
    if (!matches.length) continue;
    const raw = (matches[0][2] || matches[0][1]).replace(",", ".");
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n > 5 && n < 300) return n;
  }
  return null;
}

/**
 * Litrenin altındaki yakıt ibaresi.
 * MOT.VMAX / V/MAX DIESEL → motorin
 * KURSUNSUZ / BENZIN → benzin
 * OTOGAZ / LPG → otogaz
 */
export function parseFuelKindFromText(text: string): FuelKind {
  const t = text
    .toUpperCase()
    .replace(/İ/g, "I")
    .replace(/Ş/g, "S")
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/Ç/g, "C");

  // Motorin / VMax diesel
  if (
    /MOT\.?\s*V\s*MAX|MOT\.?\s*VMAX|V\s*\/?\s*MAX\s*DIESEL|VMAX\s*DIESEL|MOTORIN|DIZEL|DIESEL|MAZOT/.test(
      t
    )
  ) {
    return "MOTORIN";
  }

  // Benzin
  if (
    /KURSUNSUZ|BENZIN|V\s*\/?\s*MAX.*95|VMAX\s*95|K95|95\s*OKTAN/.test(t)
  ) {
    return "BENZIN";
  }

  // Otogaz / LPG
  if (/OTOG[AZ]|PO\s*\/?\s*GAZ|LPG|\bGAZ\b/.test(t) && !/MAZOT|DIESEL|MOTORIN/.test(t)) {
    return "LPG";
  }

  return "UNKNOWN";
}

export function parsePlateFromText(text: string): string | null {
  const m = text.match(/\b(\d{2}\s*[A-ZÇĞİÖŞÜa-zçğıöşü]{1,3}\s*\d{2,4})\b/);
  if (!m) return null;
  return m[1].replace(/\s+/g, " ").toUpperCase();
}

export function fuelKindToTransactionType(kind: FuelKind): string | null {
  if (kind === "MOTORIN") return "FUEL_MOTORIN";
  if (kind === "BENZIN") return "FUEL_BENZIN";
  // Otogaz için formda OTHER veya mevcut tip yoksa null — UI'da OTHER seçilebilir
  if (kind === "LPG") return "OTHER";
  return null;
}

function emptyExtraction(): ReceiptExtraction {
  return {
    amount: null,
    dateTime: null,
    date: null,
    time: null,
    text: "",
    receiptNo: null,
    liters: null,
    fuelKind: "UNKNOWN",
    plate: null,
    unitPrice: null,
  };
}

function parseFromFilename(originalName: string): ReceiptExtraction {
  const base = emptyExtraction();
  const amountMatch = originalName.match(/(?:receipt|fis|amount)[_\-]?(\d+(?:[.,]\d{1,2})?)/i);
  base.amount = amountMatch ? parseFloat(amountMatch[1].replace(",", ".")) : null;

  const dtMatch = originalName.match(/(\d{2})(\d{2})(\d{4})[_\-]?(\d{2})(\d{2})/);
  base.dateTime = dtMatch
    ? buildIstanbulDateTime(
        parseInt(dtMatch[1], 10),
        parseInt(dtMatch[2], 10),
        parseInt(dtMatch[3], 10),
        parseInt(dtMatch[4], 10),
        parseInt(dtMatch[5], 10)
      )
    : null;
  if (base.dateTime) {
    base.date = `${dtMatch![3]}-${dtMatch![2]}-${dtMatch![1]}`;
    base.time = `${dtMatch![4]}:${dtMatch![5]}`;
  }

  return base;
}

export function parseReceiptDetailsFromText(text: string): Omit<ReceiptExtraction, "text"> {
  const dateParts = parseDateParts(text);
  const timeParts = parseTimeParts(text);
  const dateTime =
    dateParts && timeParts
      ? buildIstanbulDateTime(
          dateParts.day,
          dateParts.month,
          dateParts.year,
          timeParts.hour,
          timeParts.minute
        )
      : null;

  const liters = parseLitersFromText(text);
  const unitPrice = parseUnitPriceFromText(text);
  const rawAmount = parseAmountFromText(text);

  return {
    amount: refineReceiptAmount(rawAmount, liters, unitPrice),
    dateTime,
    date: dateParts ? formatDateField(dateParts) : null,
    time: timeParts ? formatTimeField(timeParts) : null,
    receiptNo: parseReceiptNoFromText(text),
    liters,
    fuelKind: parseFuelKindFromText(text),
    plate: parsePlateFromText(text),
    unitPrice,
  };
}

export async function extractFromReceipt(
  filePath: string,
  originalName: string
): Promise<ReceiptExtraction> {
  const fromName = parseFromFilename(originalName);

  try {
    const result = await Tesseract.recognize(filePath, "tur+eng", {
      logger: () => {},
    });
    const text = result.data.text;
    const details = parseReceiptDetailsFromText(text);
    return {
      amount: details.amount ?? fromName.amount,
      dateTime: details.dateTime ?? fromName.dateTime,
      date: details.date ?? fromName.date,
      time: details.time ?? fromName.time,
      text,
      receiptNo: details.receiptNo,
      liters: details.liters,
      fuelKind: details.fuelKind,
      plate: details.plate,
      unitPrice: details.unitPrice,
    };
  } catch (err) {
    console.warn("OCR hatası:", err);
    return { ...fromName, text: "" };
  }
}

/** @deprecated extractFromReceipt kullanın */
export async function extractAmountFromReceipt(
  filePath: string,
  originalName: string
): Promise<number | null> {
  const { amount } = await extractFromReceipt(filePath, originalName);
  return amount;
}

function istanbulDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ISTANBUL_TZ }).format(date);
}

export function isDateTimeWithinTolerance(
  transactionCreatedAt: Date,
  receiptDateTime: Date | null
): boolean | null {
  if (!receiptDateTime) return null;

  if (istanbulDateKey(transactionCreatedAt) !== istanbulDateKey(receiptDateTime)) {
    return false;
  }

  const diffMinutes =
    Math.abs(transactionCreatedAt.getTime() - receiptDateTime.getTime()) / 60000;

  return diffMinutes <= config.ocrTimeToleranceMinutes;
}

export function evaluateSuspicion(
  enteredAmount: number,
  receiptAmount: number | null,
  transactionCreatedAt: Date,
  receiptDateTime: Date | null
): { status: SuspicionStatus; diff: number | null } {
  const amountReadable = receiptAmount !== null;
  const dateTimeCheck = isDateTimeWithinTolerance(transactionCreatedAt, receiptDateTime);
  const dateTimeReadable = dateTimeCheck !== null;

  if (!amountReadable && !dateTimeReadable) {
    return { status: SuspicionStatus.SUSPICIOUS_UNREADABLE, diff: null };
  }

  const diff = amountReadable ? enteredAmount - receiptAmount! : null;

  if (amountReadable) {
    const amountOk = Math.abs(diff!) <= config.ocrToleranceTl;
    if (!amountOk) {
      return { status: SuspicionStatus.SUSPICIOUS_MISMATCH, diff };
    }
  } else {
    return { status: SuspicionStatus.SUSPICIOUS_UNREADABLE, diff: null };
  }

  if (!dateTimeReadable) {
    return { status: SuspicionStatus.SUSPICIOUS_UNREADABLE, diff };
  }

  if (dateTimeCheck === false) {
    return { status: SuspicionStatus.SUSPICIOUS_DATETIME_MISMATCH, diff };
  }

  return { status: SuspicionStatus.NORMAL, diff };
}

import { SuspicionStatus } from "@prisma/client";
import Tesseract from "tesseract.js";
import { config } from "../lib/config.js";

const ISTANBUL_TZ = "Europe/Istanbul";

export type FuelKind = "MOTORIN" | "BENZIN" | "LPG" | "UNKNOWN";

export type ReceiptExtraction = {
  amount: number | null;
  dateTime: Date | null;
  text: string;
  receiptNo: string | null;
  liters: number | null;
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

/** Fiş metninden olası tutarları çıkarır */
export function parseAmountFromText(text: string): number | null {
  const normalized = text.replace(/\s+/g, " ");

  const priorityPatterns = [
    /(?:TOPLAM|TUTAR|TOP|AMOUNT|GENEL\s*TOPLAM)[:\s*]*(\d{1,6}[.,]\d{2})/gi,
    /(\d{1,6}[.,]\d{2})\s*(?:TL|₺)/gi,
  ];

  for (const pattern of priorityPatterns) {
    const matches = [...normalized.matchAll(pattern)];
    if (matches.length > 0) {
      const last = matches[matches.length - 1][1];
      return parseFloat(last.replace(",", "."));
    }
  }

  const amounts = [...normalized.matchAll(/(\d{1,6}[.,]\d{2})/g)]
    .map((m) => parseFloat(m[1].replace(",", ".")))
    .filter((n) => n > 0 && n < 100000);

  if (amounts.length === 0) return null;
  return Math.max(...amounts);
}

function normalizeYear(year: number): number {
  if (year < 100) return 2000 + year;
  return year;
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
  const iso = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+03:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

type DateParts = { day: number; month: number; year: number };
type TimeParts = { hour: number; minute: number };

function parseDateParts(text: string): DateParts | null {
  const patterns = [
    /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/g,
    /(\d{4})[./-](\d{1,2})[./-](\d{1,2})/g,
  ];

  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length === 0) continue;

    const m = matches[matches.length - 1];
    if (pattern.source.startsWith("(\\d{4})")) {
      return {
        year: parseInt(m[1], 10),
        month: parseInt(m[2], 10),
        day: parseInt(m[3], 10),
      };
    }
    return {
      day: parseInt(m[1], 10),
      month: parseInt(m[2], 10),
      year: parseInt(m[3], 10),
    };
  }

  return null;
}

function parseTimeParts(text: string): TimeParts | null {
  const patterns = [
    /(?:SAAT|TAR[İI]H\s*\/\s*SAAT|TIME)[:\s]*(\d{1,2})[:.](\d{2})/gi,
    /\b(\d{1,2})[:.](\d{2})(?::(\d{2}))?\b/g,
  ];

  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length === 0) continue;

    const m = matches[matches.length - 1];
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  return null;
}

/** Fiş metninden tarih + saat çıkarır */
export function parseDateTimeFromText(text: string): Date | null {
  const normalized = text.replace(/\s+/g, " ").trim();

  const combinedPatterns = [
    /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\s+(\d{1,2})[:.](\d{2})/g,
    /(\d{1,2})[:.](\d{2})\s+(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/g,
    /(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s+(\d{1,2})[:.](\d{2})/g,
  ];

  for (const pattern of combinedPatterns) {
    const matches = [...normalized.matchAll(pattern)];
    if (matches.length === 0) continue;

    const m = matches[matches.length - 1];
    if (pattern.source.startsWith("(\\d{4})")) {
      return buildIstanbulDateTime(
        parseInt(m[3], 10),
        parseInt(m[2], 10),
        parseInt(m[1], 10),
        parseInt(m[4], 10),
        parseInt(m[5], 10)
      );
    }
    if (pattern.source.startsWith("(\\d{1,2})[:.]")) {
      return buildIstanbulDateTime(
        parseInt(m[3], 10),
        parseInt(m[4], 10),
        parseInt(m[5], 10),
        parseInt(m[1], 10),
        parseInt(m[2], 10)
      );
    }
    return buildIstanbulDateTime(
      parseInt(m[1], 10),
      parseInt(m[2], 10),
      parseInt(m[3], 10),
      parseInt(m[4], 10),
      parseInt(m[5], 10)
    );
  }

  const dateParts = parseDateParts(normalized);
  const timeParts = parseTimeParts(normalized);
  if (!dateParts || !timeParts) return null;

  return buildIstanbulDateTime(
    dateParts.day,
    dateParts.month,
    dateParts.year,
    timeParts.hour,
    timeParts.minute
  );
}

function getIstanbulDateParts(date: Date): DateParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: ISTANBUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
  return { day: get("day"), month: get("month"), year: get("year") };
}

function isPlausibleReceiptDate(parsed: Date, referenceDate: Date): boolean {
  if (parsed.getFullYear() < 2020) return false;
  const diffDays = Math.abs(parsed.getTime() - referenceDate.getTime()) / 86_400_000;
  return diffDays <= 2;
}

/** Fişte sadece saat varsa kayıt tarihiyle birleştirir; sahte tarihleri eler */
export function resolveReceiptDateTime(
  text: string,
  referenceDate: Date,
  parsedDateTime: Date | null
): Date | null {
  if (parsedDateTime && isPlausibleReceiptDate(parsedDateTime, referenceDate)) {
    return parsedDateTime;
  }

  const timeParts = parseTimeParts(text);
  if (!timeParts) return null;

  const { day, month, year } = getIstanbulDateParts(referenceDate);
  return buildIstanbulDateTime(day, month, year, timeParts.hour, timeParts.minute);
}

/** Fiş no — örn: FİŞ NO: 0222 */
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

/** Litre — örn: 23,560 LT · 34,56 LT */
export function parseLitersFromText(text: string): number | null {
  const normalized = text.replace(/\s+/g, " ");
  const patterns = [
    /(\d{1,4}[.,]\d{1,3})\s*(?:LT|LITRE)\b/gi,
    /(\d{1,4}[.,]\d{1,3})\s*[xX*]\s*\d/gi,
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

/** Birim fiyat fişten — örn: 42,44 veya 43,400 */
export function parseUnitPriceFromText(text: string): number | null {
  const normalized = text.replace(/\s+/g, " ");
  const patterns = [
    /(\d{1,4}[.,]\d{1,3})\s*(?:LT|LITRE)?\s*[xX*]\s*(\d{1,4}[.,]\d{1,3})/gi,
    /(?:BIRIM|FIYAT|UNIT)[:\s]*(\d{1,4}[.,]\d{1,3})/gi,
  ];

  for (const pattern of patterns) {
    const matches = [...normalized.matchAll(pattern)];
    if (!matches.length) continue;
    // "34,56 LT X 43,400" → group 2 is unit price
    const raw = (matches[0][2] || matches[0][1]).replace(",", ".");
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n > 5 && n < 200) return n;
  }
  return null;
}

export function parseFuelKindFromText(text: string): FuelKind {
  const t = text.toUpperCase()
    .replace(/İ/g, "I")
    .replace(/Ş/g, "S")
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/Ç/g, "C");

  if (
    /V\s*\/?\s*MAX\s*DIESEL|MOT\.?\s*VMAX|MOTORIN|DIZEL|DIESEL|MAZOT/.test(t)
  ) {
    return "MOTORIN";
  }
  if (
    /KURSUNSUZ|BENZIN|V\s*\/?\s*MAX.*95|VMAX\s*95|K95/.test(t)
  ) {
    return "BENZIN";
  }
  if (/OTOG[AZ]|PO\s*\/?\s*GAZ|LPG/.test(t)) {
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
  return null;
}

function emptyExtraction(): ReceiptExtraction {
  return {
    amount: null,
    dateTime: null,
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

  return base;
}

export function parseReceiptDetailsFromText(text: string): Omit<ReceiptExtraction, "text"> {
  return {
    amount: parseAmountFromText(text),
    dateTime: parseDateTimeFromText(text),
    receiptNo: parseReceiptNoFromText(text),
    liters: parseLitersFromText(text),
    fuelKind: parseFuelKindFromText(text),
    plate: parsePlateFromText(text),
    unitPrice: parseUnitPriceFromText(text),
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

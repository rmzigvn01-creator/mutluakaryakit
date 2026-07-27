/**
 * Petrol Ofisi / TR fiş OCR parse testleri
 * Çalıştır: npx tsx src/services/ocr.parse.test.ts
 */
import {
  parseReceiptDetailsFromText,
  parseTrMoney,
  parseFuelKindFromText,
  parseAmountFromText,
  parseDateParts,
  refineReceiptAmount,
  resolveReceiptDateTime,
} from "./ocr.service.js";

const SAMPLE = `
ADABAŞI PETROL İNŞ. OTOM. TUR. HAY. SAN. VE TİC. A.Ş.
OVACIK MAH. YOZGAT BULVARI NO:58 06280 KEÇİÖREN/ANKARA
TEL: 03123780089
03-02-2024                    17:47
FİŞ NO: 0222
23,560 LT X 42,44
MOT.VMAX
%20 *1.000,00
TOPKDV *166,67
TOPLAM *1.000,00
NAKİT *1.000,00
EKÜ NO: 1
Z NO: 0026
`;

/** Merzifon örneği — temiz metin */
const MERZIFON = `
EYMEN ASAF NAK. AKARYAKIT İNŞ.OTO.SAN.VE TİC.LTD.ŞTİ.
GÖKÇEBAĞ KÖYÜ ÖREN MEVKİ KUM, NO:166/1 MERZİFON
MERZİFON VD: VN:3830698536
MERSİS NO: 0383069853600001
LİSANS NO: BAY/939-82/42684
İSTASYON ADA: 9-10
11-07-2025                    01:09
FİŞ NO: 0257
2921271222
84,15 LT X 51,22
MOTORİN %20 *4.309,74
KDV *718,29
TOPLAM *4.309,74
NAKİT *4.309,74
`;

/** Gerçek Tesseract çıktısına yakın (bozuk) */
const MERZIFON_OCR_GARBAGE = `
EYMEN ASAF NAK, AKARYAKIT
İNŞ.OTO.SAN.VE TİC.LTO.ŞTİ.
LISANS NO:BAY/939-82/42684
İSTASYON ADA-3-10
Bet 01:03
FİŞ NO:0257
2921271222
84,15 LT X 51,22 44309,74
MOTORİN 2ZDE SEA Sst Ez
KOv 430974
fn 430878
NAKİT
EKÜ NO: pe DK 23121
`;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const d = parseReceiptDetailsFromText(SAMPLE);
assert(d.date === "2024-02-03", `date expected 2024-02-03 got ${d.date}`);
assert(d.time === "17:47", `time expected 17:47 got ${d.time}`);
assert(d.receiptNo === "0222", `receiptNo expected 0222 got ${d.receiptNo}`);
assert(d.liters === 23.56, `liters expected 23.56 got ${d.liters}`);
assert(d.fuelKind === "MOTORIN", `fuelKind expected MOTORIN got ${d.fuelKind}`);
assert(d.amount === 1000, `amount expected 1000 got ${d.amount}`);
assert(d.unitPrice === 42.44, `unitPrice expected 42.44 got ${d.unitPrice}`);

assert(parseTrMoney("1.000,00") === 1000, "parseTrMoney 1.000,00");
assert(parseTrMoney("*1.000,00") === 1000, "parseTrMoney *1.000,00");
assert(parseTrMoney("42,44") === 42.44, "parseTrMoney 42,44");
assert(parseTrMoney("4.309,74") === 4309.74, "parseTrMoney 4.309,74");
assert(parseTrMoney("430974") === 4309.74, "OCR 430974 → 4309.74");
assert(parseTrMoney("430974.00") === 4309.74, "OCR 430974.00 → 4309.74");
assert(parseTrMoney("4.309.74") === 4309.74, "OCR 4.309.74 → 4309.74");

assert(parseFuelKindFromText("KURSUNSUZ 95") === "BENZIN", "benzin");
assert(parseFuelKindFromText("OTOGAZ") === "LPG", "otogaz");
assert(parseFuelKindFromText("MOT.VMAX") === "MOTORIN", "mot.vmax");
assert(parseFuelKindFromText("V/MAX DIESEL") === "MOTORIN", "vmax diesel");
assert(parseFuelKindFromText("BENZIN") === "BENZIN", "benzin word");

const m = parseReceiptDetailsFromText(MERZIFON);
assert(m.date === "2025-07-11", `merzifon date got ${m.date}`);
assert(m.time === "01:09", `merzifon time got ${m.time}`);
assert(m.amount === 4309.74, `merzifon amount got ${m.amount}`);
assert(m.liters === 84.15, `merzifon liters got ${m.liters}`);
assert(m.unitPrice === 51.22, `merzifon unit got ${m.unitPrice}`);
assert(m.receiptNo === "0257", `merzifon fis got ${m.receiptNo}`);

// Lisans NO tarih sanılmamalı
const badLicense = parseDateParts("LISANS NO:BAY/939-82/42684\nFİŞ NO:0257");
assert(badLicense === null, `license must not be date got ${JSON.stringify(badLicense)}`);

assert(parseAmountFromText("TOPLAM *430974.00") === 4309.74, "TOPLAM mangled .00");
assert(parseAmountFromText("TOPLAM 430974") === 4309.74, "TOPLAM mangled int");

const g = parseReceiptDetailsFromText(MERZIFON_OCR_GARBAGE);
assert(g.liters === 84.15, `garbage liters got ${g.liters}`);
assert(g.unitPrice === 51.22, `garbage unit got ${g.unitPrice}`);
assert(
  g.amount !== null && Math.abs(g.amount - 4309.74) < 0.01,
  `garbage amount should 4309.74 via lt×price got ${g.amount}`
);

assert(
  refineReceiptAmount(430974, 84.15, 51.22) === 4309.74,
  "refine 430974 with lt×price"
);

// Eski fiş tarihi bugüne düşmemeli (3 yıl penceresi)
const parsed = new Date("2025-07-11T01:09:00+03:00");
const ref = new Date("2026-07-27T14:00:00+03:00");
const resolved = resolveReceiptDateTime(
  "11-07-2025 01:09\nFİŞ NO: 0257\nTOPLAM *4.309,74",
  ref,
  parsed
);
assert(resolved !== null, "resolved dateTime null");
assert(
  resolved!.toISOString().startsWith("2025-07-10") ||
    resolved!.toISOString().startsWith("2025-07-11"),
  `resolved should stay 2025 got ${resolved!.toISOString()}`
);

// Tarih okunamadıysa bugüne yapıştırma
const noFake = resolveReceiptDateTime("FİŞ NO:0257\n01:09\nTOPLAM *100,00", ref, null);
assert(noFake === null, `must not invent today got ${noFake}`);

console.log("OCR parse tests OK");
console.log("adabasi", JSON.stringify(d, null, 2));
console.log("merzifon", JSON.stringify(m, null, 2));
console.log("garbage", JSON.stringify(g, null, 2));

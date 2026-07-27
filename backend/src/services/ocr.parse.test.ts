/**
 * Petrol Ofisi fiş OCR parse testleri (işaretli alanlar)
 * Çalıştır: npx tsx src/services/ocr.parse.test.ts
 */
import {
  parseReceiptDetailsFromText,
  parseTrMoney,
  parseFuelKindFromText,
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

assert(parseFuelKindFromText("KURSUNSUZ 95") === "BENZIN", "benzin");
assert(parseFuelKindFromText("OTOGAZ") === "LPG", "otogaz");
assert(parseFuelKindFromText("MOT.VMAX") === "MOTORIN", "mot.vmax");
assert(parseFuelKindFromText("V/MAX DIESEL") === "MOTORIN", "vmax diesel");
assert(parseFuelKindFromText("BENZIN") === "BENZIN", "benzin word");

console.log("OCR parse tests OK");
console.log(JSON.stringify(d, null, 2));

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../..");

export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  uploadDir: process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(backendRoot, "uploads"),
  supabaseUrl: (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, ""),
  supabaseServiceKey: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
  supabaseBucket: (process.env.SUPABASE_BUCKET ?? "mutlu-files").trim(),
  ocrToleranceTl: parseFloat(process.env.OCR_TOLERANCE_TL ?? "2"),
  ocrTimeToleranceMinutes: parseInt(process.env.OCR_TIME_TOLERANCE_MINUTES ?? "30", 10),
  backendRoot,
  fcmServerKey: process.env.FCM_SERVER_KEY ?? "",
  fuelPriceCityId: process.env.FUEL_PRICE_CITY_ID ?? "22",
  fuelPriceCityName: process.env.FUEL_PRICE_CITY_NAME ?? "Edirne",
  fuelPriceDistrictId: process.env.FUEL_PRICE_DISTRICT_ID ?? "02203",
  fuelPriceDistrictName: process.env.FUEL_PRICE_DISTRICT_NAME ?? "İpsala",
  fuelPricePollIntervalMs: parseInt(process.env.FUEL_PRICE_POLL_MS ?? String(5 * 60 * 1000), 10),
};

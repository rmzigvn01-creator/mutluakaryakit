import express from "express";
import cors from "cors";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./lib/config.js";
import authRoutes from "./routes/auth.routes.js";
import transactionRoutes from "./routes/transactions.routes.js";
import correctionRoutes from "./routes/corrections.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import reportRoutes from "./routes/reports.routes.js";
import syncRoutes from "./routes/sync.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import shiftsRoutes from "./routes/shifts.routes.js";
import notificationsRoutes from "./routes/notifications.routes.js";
import creditRoutes from "./routes/credit.routes.js";
import expenseRoutes from "./routes/expense.routes.js";
import vehicleRoutes from "./routes/vehicles.routes.js";
import fuelPriceRoutes from "./routes/fuel-prices.routes.js";
import announcementRoutes from "./routes/announcements.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import { refreshFuelPrices, startFuelPricePoller } from "./services/fuel-price.service.js";
import { startPendingOcrRecovery } from "./services/ocr-queue.service.js";
import { backfillUsernames } from "./lib/backfill-usernames.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();

app.disable("x-powered-by");
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "15mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "mutluakaryakit-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/corrections", correctionRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/shifts", shiftsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/credit", creditRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/fuel-prices", fuelPriceRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/chat", chatRoutes);

app.use(express.static(path.join(__dirname, "../public"), {
  etag: true,
  lastModified: true,
  index: "index.html",
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return;
    }
    // app.js?v= sorgusu ile cache kırılır; CSS/SVG uzun süre cache
    if (filePath.endsWith(".js")) {
      res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
      return;
    }
    if (filePath.endsWith(".css") || filePath.endsWith(".svg") || filePath.endsWith(".woff2")) {
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    }
  },
}));

// Kök ve bilinmeyen GET'ler → arayüz (Render free "Not Found" / cache karışıklığını azaltır)
app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api")) {
    res.status(404).json({ error: "Bulunamadı" });
    return;
  }
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(__dirname, "../public/index.html"), (err) => {
    if (err) next(err);
  });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (err.message.includes("Sadece görüntü")) {
    res.status(400).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: "Sunucu hatası" });
});

const isVercel = Boolean(process.env.VERCEL);
const isServerless = isVercel || process.env.AWS_LAMBDA_FUNCTION_NAME;

if (!isServerless) {
  app.listen(config.port, "0.0.0.0", () => {
    console.log(`Mutlu Akaryakıt → http://localhost:${config.port}`);
    console.log(`Telefondan erişim için bilgisayar IP adresinizi kullanın`);
    startFuelPricePoller();
    startPendingOcrRecovery();
    void backfillUsernames().catch((err) => {
      console.warn("[users] username backfill:", err);
    });
  });
} else {
  // Serverless: tek seferlik çekim (setInterval yok / soğuk start)
  void refreshFuelPrices().catch((err) => {
    console.warn("[fuel-prices] serverless ilk çekim:", err);
  });
  void backfillUsernames().catch((err) => {
    console.warn("[users] username backfill:", err);
  });
}

export default app;

import { Router } from "express";
import type express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import {
  TransactionType,
  UserRole,
  SuspicionStatus,
  CorrectionType,
  CorrectionStatus,
  ShiftStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import { authMiddleware, requireRoles, AuthRequest } from "../middleware/auth.js";
import { extractFromReceipt, fuelKindToTransactionType } from "../services/ocr.service.js";
import { isAllowedReceiptUpload, normalizeReceiptImage } from "../services/image.service.js";
import { logAudit } from "../services/audit.service.js";
import {
  sanitizeTransactionForRole,
  sanitizeTransactionsForRole,
} from "../lib/roles.js";
import { getLatestFuelPrices, refreshFuelPrices } from "../services/fuel-price.service.js";
import { routeId } from "../lib/route-id.js";
import { processTransactionOcr } from "../services/ocr-queue.service.js";

const router = Router();

function resolveReceiptPath(storedPath: string): string {
  if (path.isAbsolute(storedPath)) return storedPath;
  return path.resolve(config.backendRoot, storedPath.replace(/^\.\//, ""));
}


if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedReceiptUpload(file.originalname, file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Sadece görüntü dosyaları kabul edilir (JPG, PNG, HEIC)"));
    }
  },
});

function uploadReceipt(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  upload.single("receipt")(req, res, (err) => {
    if (err) {
      res.status(400).json({
        error: err.message || "Fiş fotoğrafı yüklenemedi",
      });
      return;
    }
    next();
  });
}

const VALID_TYPES = new Set<string>(Object.values(TransactionType));

router.use(authMiddleware);

/** Fiş önizleme OCR — formu otomatik doldurmak için */
router.post("/ocr-preview", uploadReceipt, async (req: AuthRequest, res) => {
  let tempPath: string | null = null;
  try {
    if (!req.file) {
      res.status(400).json({ error: "Fiş fotoğrafı zorunludur" });
      return;
    }

    const normalizedPath = await normalizeReceiptImage(req.file.path, req.file.originalname);
    tempPath = normalizedPath;

    const extracted = await extractFromReceipt(normalizedPath, req.file.originalname);
    let prices = await getLatestFuelPrices();
    if (!prices) {
      try {
        prices = await refreshFuelPrices();
      } catch {
        prices = null;
      }
    }

    const fuelKind = extracted.fuelKind;
    const suggestedType = fuelKindToTransactionType(fuelKind);

    let unitPrice: number | null = null;
    let unitPriceSource: "po" | "receipt" | null = null;
    if (prices) {
      if (fuelKind === "MOTORIN") {
        unitPrice = prices.motorin;
        unitPriceSource = "po";
      } else if (fuelKind === "BENZIN") {
        unitPrice = prices.benzin;
        unitPriceSource = "po";
      } else if (fuelKind === "LPG") {
        unitPrice = prices.lpg;
        unitPriceSource = "po";
      }
    }
    if (unitPrice === null && extracted.unitPrice !== null) {
      unitPrice = extracted.unitPrice;
      unitPriceSource = "receipt";
    }

    let calculatedAmount: number | null = null;
    if (extracted.liters !== null && unitPrice !== null) {
      calculatedAmount = Math.round(extracted.liters * unitPrice * 100) / 100;
    }

    // Sarı alan (TOPLAM) öncelikli; yoksa litre × birim fiyat
    const amount = extracted.amount ?? calculatedAmount;

    const date = extracted.date || "";
    const time = extracted.time || "";
    const dateTime = extracted.dateTime;

    const typeLabel =
      fuelKind === "MOTORIN"
        ? "Motorin"
        : fuelKind === "BENZIN"
          ? "Benzin"
          : fuelKind === "LPG"
            ? "Otogaz"
            : null;

    const descParts = [
      typeLabel && extracted.liters != null
        ? `${typeLabel} ${extracted.liters.toLocaleString("tr-TR", { maximumFractionDigits: 3 })} lt`
        : null,
      extracted.plate ? `Plaka ${extracted.plate}` : null,
      extracted.receiptNo ? `Fiş No ${extracted.receiptNo}` : null,
      date && time ? `${date.split("-").reverse().join(".")} ${time}` : null,
      extracted.amount != null
        ? `TOPLAM ${extracted.amount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL`
        : unitPrice != null
          ? `Birim ${unitPrice.toFixed(2)} TL (${unitPriceSource === "po" ? "PO İpsala" : "fiş"})`
          : null,
    ].filter(Boolean);

    res.json({
      extraction: {
        receiptNo: extracted.receiptNo,
        date,
        time,
        dateTime: dateTime?.toISOString() ?? null,
        liters: extracted.liters,
        fuelKind,
        plate: extracted.plate,
        unitPrice,
        unitPriceSource,
        receiptAmount: extracted.amount,
        calculatedAmount,
        amount,
        amountSource: extracted.amount != null ? "toplam" : calculatedAmount != null ? "litre_x_fiyat" : null,
        suggestedType,
        description: descParts.join(" · "),
        readable: Boolean(
          extracted.receiptNo ||
            extracted.liters ||
            extracted.date ||
            extracted.time ||
            extracted.amount ||
            fuelKind !== "UNKNOWN"
        ),
      },
      prices: prices
        ? {
            benzin: prices.benzin,
            motorin: prices.motorin,
            lpg: prices.lpg,
            districtName: prices.districtName,
            fetchedAt: prices.fetchedAt,
          }
        : null,
    });
  } catch (err) {
    console.error("OCR preview error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Fiş okunamadı",
    });
  } finally {
    // Geçici önizleme dosyasını sil (asıl kayıtta yeniden yüklenecek)
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
    }
    if (tempPath && tempPath !== req.file?.path) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
    }
  }
});

// Senkron: offline'dan gelen işlem + fiş
router.post("/", uploadReceipt, async (req: AuthRequest, res) => {
  try {
    const { type, enteredAmount, description, clientId, deviceInfo, createdAt, isCredit, customerId, isCompanyVehicle, vehicleId } =
      req.body as {
        type?: string;
        enteredAmount?: string;
        description?: string;
        clientId?: string;
        deviceInfo?: string;
        createdAt?: string;
        isCredit?: string | boolean;
        customerId?: string;
        isCompanyVehicle?: string | boolean;
        vehicleId?: string;
      };

    if (!req.file) {
      res.status(400).json({ error: "Fiş fotoğrafı zorunludur" });
      return;
    }

    if (!type || !VALID_TYPES.has(type)) {
      res.status(400).json({ error: "Geçerli işlem tipi gerekli" });
      return;
    }

    const amount = parseFloat(enteredAmount ?? "");
    if (isNaN(amount) || amount <= 0) {
      res.status(400).json({ error: "Geçerli tutar gerekli" });
      return;
    }

    // Pompacı: açık vardiya zorunlu
    const openShift = await prisma.shift.findFirst({
      where: {
        userId: req.user!.userId,
        stationId: req.user!.stationId,
        status: ShiftStatus.OPEN,
      },
    });
    if (req.user!.role === UserRole.STAFF && !openShift) {
      res.status(403).json({
        error: "Yeni işlem için önce vardiya başlatmalısınız",
        code: "SHIFT_REQUIRED",
      });
      return;
    }

    const creditRequested =
      isCredit === true || isCredit === "true" || isCredit === "1";
    const vehicleRequested =
      isCompanyVehicle === true || isCompanyVehicle === "true" || isCompanyVehicle === "1";

    if (creditRequested && vehicleRequested) {
      res.status(400).json({ error: "Veresiye ve şirket aracı aynı anda seçilemez" });
      return;
    }

    let creditCustomerId: string | null = null;
    if (creditRequested) {
      if (!customerId?.trim()) {
        res.status(400).json({ error: "Veresiye satış için müşteri seçin" });
        return;
      }
      const customer = await prisma.customer.findFirst({
        where: {
          id: customerId.trim(),
          stationId: req.user!.stationId,
          isActive: true,
        },
      });
      if (!customer) {
        res.status(400).json({ error: "Geçerli aktif müşteri seçin" });
        return;
      }
      creditCustomerId = customer.id;
    }

    let companyVehicleId: string | null = null;
    if (vehicleRequested) {
      if (!vehicleId?.trim()) {
        res.status(400).json({ error: "Şirket aracı seçin" });
        return;
      }
      const vehicle = await prisma.companyVehicle.findFirst({
        where: {
          id: vehicleId.trim(),
          stationId: req.user!.stationId,
          isActive: true,
        },
      });
      if (!vehicle) {
        res.status(400).json({ error: "Geçerli aktif şirket aracı seçin" });
        return;
      }
      companyVehicleId = vehicle.id;
    }

    const finalClientId = clientId || uuidv4();

    const existing = await prisma.transaction.findUnique({
      where: { clientId: finalClientId },
    });
    if (existing) {
      res.json({ transaction: existing, duplicate: true });
      return;
    }

    const normalizedPath = await normalizeReceiptImage(req.file.path, req.file.originalname);
    const transactionCreatedAt = createdAt ? new Date(createdAt) : new Date();

    const TYPE_LABELS: Record<string, string> = {
      FUEL_BENZIN: "Benzin",
      FUEL_MOTORIN: "Motorin",
      CARD_POS: "Kart (POS)",
      CASH: "Nakit",
      OTHER: "Diğer",
    };

    const resolvedPath = path.resolve(normalizedPath);
    const receiptBytes = fs.readFileSync(resolvedPath);
    const receiptMime =
      path.extname(resolvedPath).toLowerCase() === ".png"
        ? "image/png"
        : path.extname(resolvedPath).toLowerCase() === ".webp"
          ? "image/webp"
          : "image/jpeg";

    // Hızlı kayıt — OCR arka planda
    const transaction = await prisma.transaction.create({
      data: {
        clientId: finalClientId,
        stationId: req.user!.stationId,
        type: type as TransactionType,
        enteredAmount: amount,
        receiptAmount: null,
        receiptDateTime: null,
        amountDiff: null,
        description: description || null,
        receiptPath: resolvedPath,
        receiptData: receiptBytes,
        receiptMime,
        isCredit: Boolean(creditCustomerId),
        customerId: creditCustomerId,
        isCompanyVehicle: Boolean(companyVehicleId),
        vehicleId: companyVehicleId,
        suspicionStatus: SuspicionStatus.PENDING_OCR,
        createdById: req.user!.userId,
        shiftId: openShift?.id ?? null,
        deviceInfo: deviceInfo || null,
        createdAt: createdAt ? new Date(createdAt) : undefined,
      },
      omit: { receiptData: true },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        customer: { select: { id: true, name: true } },
        vehicle: { select: { id: true, name: true, plate: true } },
      },
    });

    if (creditCustomerId) {
      const creditDescParts = [
        TYPE_LABELS[type] || type,
        description?.trim() || null,
        `İşlem #${transaction.id.slice(0, 8)}`,
      ].filter(Boolean);

      await prisma.creditSale.create({
        data: {
          customerId: creditCustomerId,
          transactionId: transaction.id,
          amount,
          description: creditDescParts.join(" · "),
          createdById: req.user!.userId,
          createdAt: transaction.createdAt,
        },
      });

      await logAudit(req.user!.userId, "CREDIT_SALE", "CreditSale", transaction.id, {
        customerId: creditCustomerId,
        amount,
        transactionId: transaction.id,
      });
    }

    if (companyVehicleId) {
      const vehicle = transaction.vehicle;
      const fuelDescParts = [
        TYPE_LABELS[type] || type,
        vehicle ? `${vehicle.name} · ${vehicle.plate}` : null,
        description?.trim() || null,
        `İşlem #${transaction.id.slice(0, 8)}`,
      ].filter(Boolean);

      await prisma.vehicleFuelFill.create({
        data: {
          vehicleId: companyVehicleId,
          transactionId: transaction.id,
          amount,
          description: fuelDescParts.join(" · "),
          createdById: req.user!.userId,
          createdAt: transaction.createdAt,
        },
      });

      await logAudit(req.user!.userId, "VEHICLE_FUEL", "VehicleFuelFill", transaction.id, {
        vehicleId: companyVehicleId,
        amount,
        transactionId: transaction.id,
      });
    }

    await logAudit(req.user!.userId, "CREATE", "Transaction", transaction.id, {
      enteredAmount: amount,
      suspicionStatus: SuspicionStatus.PENDING_OCR,
      isCredit: Boolean(creditCustomerId),
      customerId: creditCustomerId,
      isCompanyVehicle: Boolean(companyVehicleId),
      vehicleId: companyVehicleId,
    });

    res.status(201).json({
      transaction: sanitizeTransactionForRole(transaction, req.user!.role),
      creditSale: Boolean(creditCustomerId),
      vehicleFuel: Boolean(companyVehicleId),
    });

    // OCR arka planda — yanıtı bekletmez
    void processTransactionOcr(transaction.id);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "İşlem kaydedilemedi" });
  }
});

router.get("/", async (req: AuthRequest, res) => {
  const {
    from,
    to,
    suspicionStatus,
    createdById,
    type,
    page = "1",
    limit = "50",
  } = req.query as Record<string, string>;

  const where: Record<string, unknown> = {
    stationId: req.user!.stationId,
    isDeleted: false,
  };

  if (req.user!.role === UserRole.STAFF) {
    where.createdById = req.user!.userId;
  }

  if (createdById && req.user!.role !== UserRole.STAFF) {
    where.createdById = createdById;
  }

  if (suspicionStatus) {
    where.suspicionStatus = suspicionStatus;
  }

  if (type) {
    where.type = type;
  }

  if (from || to) {
    where.createdAt = {};
    if (from) (where.createdAt as Record<string, Date>).gte = new Date(from);
    if (to) (where.createdAt as Record<string, Date>).lte = new Date(to);
  }

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * limitNum;

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      select: {
        id: true,
        type: true,
        enteredAmount: true,
        description: true,
        createdAt: true,
        isCredit: true,
        isCompanyVehicle: true,
        suspicionStatus: true,
        receiptAmount: true,
        receiptDateTime: true,
        amountDiff: true,
        suspicionNote: true,
        receiptPath: true,
        customerId: true,
        vehicleId: true,
        createdBy: { select: { id: true, name: true, email: true } },
        customer: { select: { id: true, name: true } },
        vehicle: { select: { id: true, name: true, plate: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limitNum,
    }),
    prisma.transaction.count({ where }),
  ]);

  res.json({
    transactions: sanitizeTransactionsForRole(transactions, req.user!.role),
    total,
    page: pageNum,
    limit: limitNum,
  });
});

router.get("/:id", async (req: AuthRequest, res) => {
  const transaction = await prisma.transaction.findFirst({
    where: {
      id: routeId(req.params.id),
      stationId: req.user!.stationId,
      isDeleted: false,
      ...(req.user!.role === UserRole.STAFF ? { createdById: req.user!.userId } : {}),
    },
    omit: { receiptData: true },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      customer: { select: { id: true, name: true } },
      vehicle: { select: { id: true, name: true, plate: true } },
      corrections: {
        orderBy: { createdAt: "desc" },
        include: {
          requestedBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!transaction) {
    res.status(404).json({ error: "İşlem bulunamadı" });
    return;
  }

  res.json({ transaction: sanitizeTransactionForRole(transaction, req.user!.role) });
});

router.get("/:id/receipt", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const transaction = await prisma.transaction.findFirst({
    where: {
      id: routeId(req.params.id),
      stationId: req.user!.stationId,
      isDeleted: false,
    },
    select: {
      receiptData: true,
      receiptMime: true,
      receiptPath: true,
    },
  });

  if (!transaction) {
    res.status(404).json({ error: "Fiş bulunamadı" });
    return;
  }

  res.setHeader("Cache-Control", "private, max-age=86400");

  // 1) Neon'daki kalıcı kopya
  if (transaction.receiptData && transaction.receiptData.length > 0) {
    res.setHeader("Content-Type", transaction.receiptMime || "image/jpeg");
    res.send(Buffer.from(transaction.receiptData));
    return;
  }

  // 2) Disk yedek (Render volume / yerel)
  if (!transaction.receiptPath) {
    res.status(404).json({ error: "Fiş bulunamadı" });
    return;
  }

  const filePath = resolveReceiptPath(transaction.receiptPath);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Fiş dosyası bulunamadı" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  res.setHeader("Content-Type", mime);
  res.sendFile(filePath);
});

// Düzeltme / silme talebi
router.post("/:id/correction-request", async (req: AuthRequest, res) => {
  const { type, reason, newValues } = req.body as {
    type?: string;
    reason?: string;
    newValues?: Record<string, unknown>;
  };

  if (!type || !["EDIT", "DELETE"].includes(type)) {
    res.status(400).json({ error: "Geçerli talep tipi gerekli (EDIT veya DELETE)" });
    return;
  }

  if (!reason?.trim()) {
    res.status(400).json({ error: "Gerekçe zorunludur" });
    return;
  }

  const transaction = await prisma.transaction.findFirst({
    where: {
      id: routeId(req.params.id),
      stationId: req.user!.stationId,
      isDeleted: false,
    },
  });

  if (!transaction) {
    res.status(404).json({ error: "İşlem bulunamadı" });
    return;
  }

  const pending = await prisma.correctionRequest.findFirst({
    where: { transactionId: transaction.id, status: CorrectionStatus.PENDING },
  });

  if (pending) {
    res.status(409).json({ error: "Bu işlem için zaten bekleyen bir talep var" });
    return;
  }

  const oldValues = {
    type: transaction.type,
    enteredAmount: transaction.enteredAmount,
    description: transaction.description,
  };

  const request = await prisma.correctionRequest.create({
    data: {
      transactionId: transaction.id,
      type: type as CorrectionType,
      reason: reason.trim(),
      oldValues: JSON.stringify(oldValues),
      newValues: newValues ? JSON.stringify(newValues) : null,
      requestedById: req.user!.userId,
    },
    include: {
      requestedBy: { select: { id: true, name: true } },
      transaction: true,
    },
  });

  await logAudit(req.user!.userId, "CORRECTION_REQUEST", "CorrectionRequest", request.id, {
    transactionId: transaction.id,
    type,
    reason,
  });

  res.status(201).json({ request });
});

export default router;

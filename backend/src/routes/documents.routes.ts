import { Router } from "express";
import type express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { DocumentCategory, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import { authMiddleware, requireRoles, AuthRequest } from "../middleware/auth.js";
import { logAudit } from "../services/audit.service.js";
import { routeId } from "../lib/route-id.js";

const router = Router();
const EXPIRY_WARN_DAYS = 30;
const CATEGORIES = new Set<string>(Object.values(DocumentCategory));

router.use(authMiddleware);
router.use(requireRoles(UserRole.ADMIN));

if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `doc-${uuidv4()}${ext}`);
  },
});

function isAllowedDocumentUpload(originalName: string, mime: string): boolean {
  const lower = (originalName || "").toLowerCase();
  const m = (mime || "").toLowerCase();
  if (m === "application/pdf" || lower.endsWith(".pdf")) return true;
  if (m.startsWith("image/")) return true;
  if (/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(lower)) return true;
  return false;
}

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedDocumentUpload(file.originalname, file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Sadece PDF veya görüntü dosyaları kabul edilir"));
    }
  },
});

function uploadDocument(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  upload.single("file")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message || "Dosya yüklenemedi" });
      return;
    }
    next();
  });
}

type ExpiryStatus = "expired" | "expiring" | "ok" | "none";

function expiryStatus(expiresAt: Date | null | undefined, now = new Date()): ExpiryStatus {
  if (!expiresAt) return "none";
  const end = new Date(expiresAt);
  end.setHours(23, 59, 59, 999);
  if (end.getTime() < now.getTime()) return "expired";
  const warnMs = EXPIRY_WARN_DAYS * 24 * 60 * 60 * 1000;
  if (end.getTime() - now.getTime() <= warnMs) return "expiring";
  return "ok";
}

function parseExpiresAt(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  const d = new Date(s.includes("T") ? s : `${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function mimeFromPath(filePath: string, fallback?: string | null): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".heic" || ext === ".heif") return "image/heic";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return fallback || "application/octet-stream";
}

function resolveStoredPath(storedPath: string): string {
  if (path.isAbsolute(storedPath)) return storedPath;
  return path.resolve(config.backendRoot, storedPath.replace(/^\.\//, ""));
}

function publicDocument(doc: {
  id: string;
  category: DocumentCategory;
  title: string;
  note: string | null;
  expiresAt: Date | null;
  fileName: string;
  fileMime: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { id: string; name: string } | null;
}) {
  return {
    id: doc.id,
    category: doc.category,
    title: doc.title,
    note: doc.note,
    expiresAt: doc.expiresAt,
    fileName: doc.fileName,
    fileMime: doc.fileMime,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdBy: doc.createdBy || null,
    expiryStatus: expiryStatus(doc.expiresAt),
  };
}

const selectPublic = {
  id: true,
  category: true,
  title: true,
  note: true,
  expiresAt: true,
  fileName: true,
  fileMime: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

router.get("/", async (req: AuthRequest, res) => {
  const category = typeof req.query.category === "string" ? req.query.category : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";

  const where: { stationId: string; category?: DocumentCategory } = {
    stationId: req.user!.stationId,
  };
  if (category && CATEGORIES.has(category)) {
    where.category = category as DocumentCategory;
  }

  const docs = await prisma.stationDocument.findMany({
    where,
    select: selectPublic,
    orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
  });

  let mapped = docs.map(publicDocument);
  if (status === "expired" || status === "expiring" || status === "ok" || status === "none") {
    mapped = mapped.filter((d) => d.expiryStatus === status);
  }

  const allExpiry = (
    await prisma.stationDocument.findMany({
      where: { stationId: req.user!.stationId },
      select: { expiresAt: true },
    })
  ).map((d) => expiryStatus(d.expiresAt));

  const summary = {
    total: allExpiry.length,
    expired: allExpiry.filter((s) => s === "expired").length,
    expiring: allExpiry.filter((s) => s === "expiring").length,
    warnDays: EXPIRY_WARN_DAYS,
  };

  res.json({ documents: mapped, summary });
});

router.post("/", uploadDocument, async (req: AuthRequest, res) => {
  const title = String(req.body?.title || "").trim();
  const category = String(req.body?.category || "").trim();
  const note = String(req.body?.note || "").trim() || null;
  const expiresParsed = parseExpiresAt(req.body?.expiresAt);

  if (!title) {
    res.status(400).json({ error: "Başlık gerekli" });
    return;
  }
  if (title.length > 160) {
    res.status(400).json({ error: "Başlık en fazla 160 karakter olabilir" });
    return;
  }
  if (!CATEGORIES.has(category)) {
    res.status(400).json({ error: "Geçersiz kategori" });
    return;
  }
  if (expiresParsed === undefined && req.body?.expiresAt) {
    res.status(400).json({ error: "Bitiş tarihi geçersiz" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Dosya gerekli (PDF veya görüntü)" });
    return;
  }

  const resolvedPath = path.resolve(req.file.path);
  const fileBytes = fs.readFileSync(resolvedPath);
  const fileMime = mimeFromPath(resolvedPath, req.file.mimetype);

  const doc = await prisma.stationDocument.create({
    data: {
      stationId: req.user!.stationId,
      category: category as DocumentCategory,
      title,
      note,
      expiresAt: expiresParsed === undefined ? null : expiresParsed,
      fileName: req.file.originalname || path.basename(resolvedPath),
      filePath: resolvedPath,
      fileData: fileBytes as never,
      fileMime,
      createdById: req.user!.userId,
    },
    select: selectPublic,
  });

  await logAudit(req.user!.userId, "DOCUMENT_CREATE", "StationDocument", doc.id, {
    title: doc.title,
    category: doc.category,
  });

  res.status(201).json({ document: publicDocument(doc) });
});

router.patch("/:id", uploadDocument, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const existing = await prisma.stationDocument.findFirst({
    where: { id, stationId: req.user!.stationId },
  });
  if (!existing) {
    res.status(404).json({ error: "Evrak bulunamadı" });
    return;
  }

  const data: {
    title?: string;
    category?: DocumentCategory;
    note?: string | null;
    expiresAt?: Date | null;
    fileName?: string;
    filePath?: string;
    fileData?: Buffer;
    fileMime?: string;
  } = {};

  if (req.body?.title !== undefined) {
    const title = String(req.body.title).trim();
    if (!title) {
      res.status(400).json({ error: "Başlık boş olamaz" });
      return;
    }
    if (title.length > 160) {
      res.status(400).json({ error: "Başlık en fazla 160 karakter olabilir" });
      return;
    }
    data.title = title;
  }

  if (req.body?.category !== undefined) {
    const category = String(req.body.category).trim();
    if (!CATEGORIES.has(category)) {
      res.status(400).json({ error: "Geçersiz kategori" });
      return;
    }
    data.category = category as DocumentCategory;
  }

  if (req.body?.note !== undefined) {
    data.note = String(req.body.note).trim() || null;
  }

  if (req.body?.expiresAt !== undefined) {
    const expiresParsed = parseExpiresAt(req.body.expiresAt);
    if (expiresParsed === undefined) {
      res.status(400).json({ error: "Bitiş tarihi geçersiz" });
      return;
    }
    data.expiresAt = expiresParsed;
  }

  if (req.file) {
    const resolvedPath = path.resolve(req.file.path);
    const fileBytes = fs.readFileSync(resolvedPath);
    data.fileName = req.file.originalname || path.basename(resolvedPath);
    data.filePath = resolvedPath;
    data.fileData = fileBytes;
    data.fileMime = mimeFromPath(resolvedPath, req.file.mimetype);
  }

  const doc = await prisma.stationDocument.update({
    where: { id },
    // Prisma Bytes typing (Buffer vs Uint8Array) — runtime OK
    data: data as never,
    select: selectPublic,
  });

  await logAudit(req.user!.userId, "DOCUMENT_UPDATE", "StationDocument", doc.id, {
    title: doc.title,
  });

  res.json({ document: publicDocument(doc) });
});

router.delete("/:id", async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const existing = await prisma.stationDocument.findFirst({
    where: { id, stationId: req.user!.stationId },
  });
  if (!existing) {
    res.status(404).json({ error: "Evrak bulunamadı" });
    return;
  }

  await prisma.stationDocument.delete({ where: { id } });

  if (existing.filePath) {
    try {
      const p = resolveStoredPath(existing.filePath);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore disk cleanup errors */
    }
  }

  await logAudit(req.user!.userId, "DOCUMENT_DELETE", "StationDocument", id, {
    title: existing.title,
  });

  res.json({ ok: true });
});

router.get("/:id/file", async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const doc = await prisma.stationDocument.findFirst({
    where: { id, stationId: req.user!.stationId },
    select: {
      fileData: true,
      fileMime: true,
      filePath: true,
      fileName: true,
    },
  });
  if (!doc) {
    res.status(404).json({ error: "Evrak bulunamadı" });
    return;
  }

  const disposition = req.query.download === "1" ? "attachment" : "inline";
  const safeName = (doc.fileName || "evrak").replace(/"/g, "");

  if (doc.fileData && doc.fileData.length > 0) {
    res.setHeader("Content-Type", doc.fileMime || "application/octet-stream");
    res.setHeader("Content-Disposition", `${disposition}; filename="${safeName}"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(Buffer.from(doc.fileData));
    return;
  }

  if (doc.filePath) {
    const p = resolveStoredPath(doc.filePath);
    if (fs.existsSync(p)) {
      res.setHeader("Content-Type", doc.fileMime || mimeFromPath(p));
      res.setHeader("Content-Disposition", `${disposition}; filename="${safeName}"`);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.sendFile(p);
      return;
    }
  }

  res.status(404).json({ error: "Dosya bulunamadı" });
});

export default router;

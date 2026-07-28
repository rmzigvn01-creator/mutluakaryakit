import { Router } from "express";
import type express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { UserRole, WorkOrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import { authMiddleware, requireRoles, AuthRequest } from "../middleware/auth.js";
import { isAllowedReceiptUpload } from "../services/image.service.js";
import { logAudit } from "../services/audit.service.js";
import { routeId } from "../lib/route-id.js";

const router = Router();

router.use(authMiddleware);

if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    let ext = path.extname(file.originalname || "").toLowerCase();
    if (!ext) {
      const m = (file.mimetype || "").toLowerCase();
      if (m === "image/png") ext = ".png";
      else if (m === "image/webp") ext = ".webp";
      else if (m.includes("jpeg")) ext = ".jpg";
      else if (m.includes("heic") || m.includes("heif")) ext = ".heic";
      else ext = ".jpg";
    }
    cb(null, `wo-${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedReceiptUpload(file.originalname, file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Tamamlama için fotoğraf gerekli (JPG, PNG, HEIC)"));
    }
  },
});

function uploadPhoto(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  upload.single("photo")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message || "Fotoğraf yüklenemedi" });
      return;
    }
    next();
  });
}

function mimeFromPath(filePath: string, fallback?: string | null): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".heic" || ext === ".heif") return "image/heic";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return fallback || "image/jpeg";
}

function resolveStoredPath(storedPath: string): string {
  if (path.isAbsolute(storedPath)) return storedPath;
  return path.resolve(config.backendRoot, storedPath.replace(/^\.\//, ""));
}

const selectPublic = {
  id: true,
  title: true,
  note: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  photoName: true,
  photoMime: true,
  createdBy: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
} as const;

function publicWorkOrder(w: {
  id: string;
  title: string;
  note: string | null;
  status: WorkOrderStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  photoName: string | null;
  photoMime: string | null;
  createdBy?: { id: string; name: string } | null;
  completedBy?: { id: string; name: string } | null;
}) {
  return {
    id: w.id,
    title: w.title,
    note: w.note,
    status: w.status,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    completedAt: w.completedAt,
    photoName: w.photoName,
    photoMime: w.photoMime,
    hasPhoto: Boolean(w.photoName || w.photoMime),
    createdBy: w.createdBy || null,
    completedBy: w.completedBy || null,
  };
}

/** Açık + son tamamlananlar — tüm roller */
router.get("/", async (req: AuthRequest, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const where: { stationId: string; status?: WorkOrderStatus } = {
    stationId: req.user!.stationId,
  };
  if (status === "OPEN" || status === "DONE" || status === "CANCELLED") {
    where.status = status as WorkOrderStatus;
  }

  const orders = await prisma.workOrder.findMany({
    where,
    select: selectPublic,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  const openCount = await prisma.workOrder.count({
    where: { stationId: req.user!.stationId, status: WorkOrderStatus.OPEN },
  });

  res.json({
    workOrders: orders.map(publicWorkOrder),
    summary: { openCount },
  });
});

/** Yönetici: yeni iş emri */
router.post("/", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const title = String(req.body?.title || "").trim();
  const note = String(req.body?.note || "").trim() || null;
  if (!title) {
    res.status(400).json({ error: "Görev metni gerekli" });
    return;
  }
  if (title.length > 300) {
    res.status(400).json({ error: "Görev metni en fazla 300 karakter olabilir" });
    return;
  }

  const order = await prisma.workOrder.create({
    data: {
      stationId: req.user!.stationId,
      title,
      note,
      createdById: req.user!.userId,
      status: WorkOrderStatus.OPEN,
    },
    select: selectPublic,
  });

  await logAudit(req.user!.userId, "WORK_ORDER_CREATE", "WorkOrder", order.id, {
    title: order.title,
  });

  res.status(201).json({ workOrder: publicWorkOrder(order) });
});

/** Personel/yönetici: fotoğrafla tamamla — fotoğrafsız kabul edilmez */
router.post(
  "/:id/complete",
  requireRoles(UserRole.ADMIN, UserRole.STAFF, UserRole.ACCOUNTANT),
  uploadPhoto,
  async (req: AuthRequest, res) => {
    try {
      const id = routeId(req.params.id);
      const existing = await prisma.workOrder.findFirst({
        where: { id, stationId: req.user!.stationId },
      });
      if (!existing) {
        res.status(404).json({ error: "İş emri bulunamadı" });
        return;
      }
      if (existing.status !== WorkOrderStatus.OPEN) {
        res.status(400).json({ error: "Bu iş emri zaten kapalı" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "Fotoğraf zorunlu — fotoğrafsız görev tamamlanamaz" });
        return;
      }

      const resolvedPath = path.resolve(req.file.path);
      if (!fs.existsSync(resolvedPath)) {
        res.status(500).json({ error: "Fotoğraf kaydedilemedi — tekrar deneyin" });
        return;
      }

      const order = await prisma.workOrder.update({
        where: { id },
        data: {
          status: WorkOrderStatus.DONE,
          completedById: req.user!.userId,
          completedAt: new Date(),
          photoPath: resolvedPath,
          photoMime: mimeFromPath(resolvedPath, req.file.mimetype),
          photoName: req.file.originalname || path.basename(resolvedPath),
        },
        select: selectPublic,
      });

      await logAudit(req.user!.userId, "WORK_ORDER_COMPLETE", "WorkOrder", order.id, {
        title: order.title,
      });

      res.json({ workOrder: publicWorkOrder(order) });
    } catch (err) {
      console.error("work order complete failed", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Tamamlanamadı",
      });
    }
  }
);

/** Yönetici: iptal */
router.post("/:id/cancel", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const existing = await prisma.workOrder.findFirst({
    where: { id, stationId: req.user!.stationId },
  });
  if (!existing) {
    res.status(404).json({ error: "İş emri bulunamadı" });
    return;
  }
  if (existing.status !== WorkOrderStatus.OPEN) {
    res.status(400).json({ error: "Sadece açık iş emirleri iptal edilebilir" });
    return;
  }

  const order = await prisma.workOrder.update({
    where: { id },
    data: { status: WorkOrderStatus.CANCELLED },
    select: selectPublic,
  });

  await logAudit(req.user!.userId, "WORK_ORDER_CANCEL", "WorkOrder", order.id, {
    title: order.title,
  });

  res.json({ workOrder: publicWorkOrder(order) });
});

/** Yönetici: sil */
router.delete("/:id", requireRoles(UserRole.ADMIN), async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const existing = await prisma.workOrder.findFirst({
    where: { id, stationId: req.user!.stationId },
  });
  if (!existing) {
    res.status(404).json({ error: "İş emri bulunamadı" });
    return;
  }

  await prisma.workOrder.delete({ where: { id } });
  if (existing.photoPath) {
    try {
      const p = resolveStoredPath(existing.photoPath);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }

  await logAudit(req.user!.userId, "WORK_ORDER_DELETE", "WorkOrder", id, {
    title: existing.title,
  });

  res.json({ ok: true });
});

/** Tamamlama fotoğrafı */
router.get("/:id/photo", async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const order = await prisma.workOrder.findFirst({
    where: { id, stationId: req.user!.stationId },
    select: { photoPath: true, photoMime: true, photoName: true, status: true },
  });
  if (!order) {
    res.status(404).json({ error: "İş emri bulunamadı" });
    return;
  }
  if (!order.photoPath) {
    res.status(404).json({ error: "Fotoğraf yok" });
    return;
  }
  const p = resolveStoredPath(order.photoPath);
  if (!fs.existsSync(p)) {
    res.status(404).json({ error: "Fotoğraf dosyası bulunamadı" });
    return;
  }
  const safeName = (order.photoName || "is-emri.jpg").replace(/"/g, "");
  res.setHeader("Content-Type", order.photoMime || mimeFromPath(p));
  res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.sendFile(p);
});

export default router;

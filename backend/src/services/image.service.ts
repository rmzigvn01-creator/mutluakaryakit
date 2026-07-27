import fs from "fs";
import path from "path";
import convert from "heic-convert";

const HEIC_EXTS = new Set([".heic", ".heif"]);

export function isHeicFile(filePath: string, originalName?: string): boolean {
  const ext = path.extname(originalName || filePath).toLowerCase();
  return HEIC_EXTS.has(ext);
}

export function isAllowedReceiptUpload(originalName: string, mimetype: string): boolean {
  const ext = path.extname(originalName).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"].includes(ext)) return true;
  if (mimetype.startsWith("image/")) return true;
  if (mimetype === "application/octet-stream" && HEIC_EXTS.has(ext)) return true;
  return false;
}

/** iPhone HEIC/HEIF → JPEG (OCR ve tarayıcı önizlemesi için) */
export async function normalizeReceiptImage(
  filePath: string,
  originalName?: string
): Promise<string> {
  if (!isHeicFile(filePath, originalName)) return filePath;

  const inputBuffer = fs.readFileSync(filePath);
  const outputBuffer = await convert({
    buffer: inputBuffer,
    format: "JPEG",
    quality: 0.92,
  });

  const jpgPath = filePath.replace(/\.(heic|heif)$/i, ".jpg");
  fs.writeFileSync(jpgPath, Buffer.from(outputBuffer));
  fs.unlinkSync(filePath);

  return jpgPath;
}

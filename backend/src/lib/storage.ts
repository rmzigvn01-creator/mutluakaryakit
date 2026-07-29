import fs from "fs";
import path from "path";
import { config } from "./config.js";

/**
 * Supabase Storage — kalıcı dosya deposu.
 * Render diski olmadan da evrak/fotoğraflar yeniden başlatmada kaybolmaz.
 */

const UPLOAD_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

let bucketReady = false;

export function storageEnabled(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseServiceKey);
}

function encodeKey(key: string): string {
  return key
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function objectUrl(key: string): string {
  return `${config.supabaseUrl}/storage/v1/object/${encodeURIComponent(config.supabaseBucket)}/${encodeKey(key)}`;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.supabaseServiceKey}`,
    apikey: config.supabaseServiceKey,
  };
}

/** Bucket yoksa oluştur (private). Zaten varsa sessizce geç. */
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const res = await fetch(`${config.supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      id: config.supabaseBucket,
      name: config.supabaseBucket,
      public: false,
    }),
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (res.ok || res.status === 409) {
    bucketReady = true;
    return;
  }

  const text = await res.text().catch(() => "");
  if (/exist/i.test(text)) {
    bucketReady = true;
    return;
  }
  throw new Error(`Depo hazırlanamadı (${res.status}) ${text.slice(0, 200)}`);
}

export async function uploadObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  if (!storageEnabled()) throw new Error("Supabase Storage yapılandırılmadı");
  await ensureBucket();

  const res = await fetch(objectUrl(key), {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
      "cache-control": "3600",
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dosya depoya yüklenemedi (${res.status}) ${text.slice(0, 200)}`);
  }
}

export async function downloadObject(
  key: string
): Promise<{ body: Buffer; contentType: string } | null> {
  if (!storageEnabled()) return null;

  const res = await fetch(objectUrl(key), {
    headers: authHeaders(),
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) return null;

  const buf = Buffer.from(await res.arrayBuffer());
  return {
    body: buf,
    contentType: res.headers.get("content-type") || "application/octet-stream",
  };
}

/**
 * Diskteki geçici yüklemeyi kalıcı depoya taşı.
 * Depo kapalı ya da hata verirse `null` döner; çağıran diskle devam eder.
 */
export async function moveLocalFileToStorage(
  localPath: string,
  prefix: string,
  contentType: string
): Promise<string | null> {
  if (!storageEnabled()) return null;
  try {
    const key = `${prefix}/${path.basename(localPath)}`;
    await uploadObject(key, fs.readFileSync(localPath), contentType);
    try {
      fs.unlinkSync(localPath);
    } catch {
      /* geçici dosya silinemezse sorun değil */
    }
    return key;
  } catch (err) {
    console.error("storage upload failed, disk kullanılacak", err);
    return null;
  }
}

export async function removeObject(key: string): Promise<void> {
  if (!storageEnabled()) return;
  try {
    await fetch(objectUrl(key), {
      method: "DELETE",
      headers: authHeaders(),
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    /* silme hatası kaydı engellemesin */
  }
}

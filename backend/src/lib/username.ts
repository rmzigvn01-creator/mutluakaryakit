/** Normalize login nick: lowercase, trim, Turkish → ASCII */
export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

/** Nick rules: 3–32 chars, letters/digits/_ . - */
export function isValidUsername(raw: string): boolean {
  const u = normalizeUsername(raw);
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(u);
}

export function usernameFromEmail(email: string): string {
  const local = email.split("@")[0] || email;
  const cleaned = normalizeUsername(local);
  if (cleaned.length >= 3) return cleaned.slice(0, 32);
  return `user${cleaned}`.slice(0, 32);
}

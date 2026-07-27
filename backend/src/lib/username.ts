/** Normalize login nick: lowercase, trim */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Nick rules: 3–32 chars, letters/digits/_ . - */
export function isValidUsername(raw: string): boolean {
  const u = normalizeUsername(raw);
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(u);
}

export function usernameFromEmail(email: string): string {
  const local = email.split("@")[0] || email;
  const cleaned = normalizeUsername(local).replace(/[^a-z0-9._-]/g, "");
  if (cleaned.length >= 3) return cleaned.slice(0, 32);
  return `user${cleaned}`.slice(0, 32);
}

import { prisma } from "../lib/prisma.js";
import { usernameFromEmail } from "./username.js";

/** Mevcut e-posta hesaplarına nick ata (bir kez / idempotent). */
export async function backfillUsernames(): Promise<void> {
  const missing = await prisma.user.findMany({
    where: { OR: [{ username: null }, { username: "" }] },
    select: { id: true, email: true, username: true },
  });

  for (const user of missing) {
    if (!user.email) continue;
    let base = usernameFromEmail(user.email);
    let candidate = base;
    let n = 1;
    while (true) {
      const taken = await prisma.user.findFirst({
        where: { username: candidate, id: { not: user.id } },
        select: { id: true },
      });
      if (!taken) break;
      n += 1;
      candidate = `${base}${n}`.slice(0, 32);
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { username: candidate },
    });
  }
}

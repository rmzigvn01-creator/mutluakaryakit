import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const station = await prisma.station.upsert({
    where: { id: "seed-station-1" },
    update: {},
    create: {
      id: "seed-station-1",
      name: "Mutlu Akaryakıt",
    },
  });

  const users = [
    {
      username: "admin",
      email: "admin@mutluakaryakit.local",
      password: "admin123",
      name: "Yönetici",
      role: UserRole.ADMIN,
    },
    {
      username: "ahmet",
      email: "ahmet@mutluakaryakit.local",
      password: "staff123",
      name: "Ahmet (Pompacı)",
      role: UserRole.STAFF,
    },
    {
      username: "mehmet",
      email: "mehmet@mutluakaryakit.local",
      password: "staff123",
      name: "Mehmet (Pompacı)",
      role: UserRole.STAFF,
    },
    {
      username: "muhasebe",
      email: "muhasebe@mutluakaryakit.local",
      password: "staff123",
      name: "Muhasebeci",
      role: UserRole.ACCOUNTANT,
    },
  ];

  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 10);
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ username: u.username }, { email: u.email }],
      },
    });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { name: u.name, role: u.role, username: u.username, email: u.email },
      });
    } else {
      await prisma.user.create({
        data: {
          username: u.username,
          email: u.email,
          passwordHash: hash,
          name: u.name,
          role: u.role,
          stationId: station.id,
        },
      });
    }
    console.log(`✓ ${u.role.padEnd(10)} ${u.username} / ${u.password}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

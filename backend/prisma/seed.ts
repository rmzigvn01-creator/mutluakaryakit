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
      email: "admin@mutluakaryakit.local",
      password: "admin123",
      name: "Yönetici",
      role: UserRole.ADMIN,
    },
    {
      email: "ahmet@mutluakaryakit.local",
      password: "staff123",
      name: "Ahmet (Pompacı)",
      role: UserRole.STAFF,
    },
    {
      email: "mehmet@mutluakaryakit.local",
      password: "staff123",
      name: "Mehmet (Pompacı)",
      role: UserRole.STAFF,
    },
    {
      email: "muhasebe@mutluakaryakit.local",
      password: "staff123",
      name: "Muhasebeci",
      role: UserRole.ACCOUNTANT,
    },
  ];

  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 10);
    // Mevcut kullanıcıların şifresini production'da ezme — sadece yoksa oluştur
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role },
      create: {
        email: u.email,
        passwordHash: hash,
        name: u.name,
        role: u.role,
        stationId: station.id,
      },
    });
    console.log(`✓ ${u.role.padEnd(10)} ${u.email} / ${u.password}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

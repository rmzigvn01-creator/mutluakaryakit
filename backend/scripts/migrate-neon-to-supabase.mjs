/**
 * One-shot: copy Neon → Supabase (same Prisma schema).
 * Requires NEON_DIRECT_URL + DIRECT_URL (or DATABASE_URL without pgbouncer).
 */
import { PrismaClient } from "@prisma/client";

const neonUrl = process.env.NEON_DIRECT_URL || process.env.NEON_DATABASE_URL;
const destUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!neonUrl || !destUrl) {
  console.error("Need NEON_DIRECT_URL and DIRECT_URL");
  process.exit(1);
}

const source = new PrismaClient({ datasources: { db: { url: neonUrl.replace(/[?&]pgbouncer=true/, "") } } });
const dest = new PrismaClient({ datasources: { db: { url: destUrl.replace(/[?&]pgbouncer=true/, "") } } });

async function copy(name, findMany, createMany) {
  const rows = await findMany();
  if (!rows.length) {
    console.log(`${name}: 0`);
    return;
  }
  const chunk = 200;
  for (let i = 0; i < rows.length; i += chunk) {
    await createMany(rows.slice(i, i + chunk));
  }
  console.log(`${name}: ${rows.length}`);
}

async function main() {
  // Order respects FKs
  await copy("Station", () => source.station.findMany(), (d) => dest.station.createMany({ data: d, skipDuplicates: true }));
  await copy("User", () => source.user.findMany(), (d) => dest.user.createMany({ data: d, skipDuplicates: true }));
  await copy("Customer", () => source.customer.findMany(), (d) => dest.customer.createMany({ data: d, skipDuplicates: true }));
  await copy("Supplier", () => source.supplier.findMany(), (d) => dest.supplier.createMany({ data: d, skipDuplicates: true }));
  await copy("CompanyVehicle", () => source.companyVehicle.findMany(), (d) => dest.companyVehicle.createMany({ data: d, skipDuplicates: true }));
  await copy("Shift", () => source.shift.findMany(), (d) => dest.shift.createMany({ data: d, skipDuplicates: true }));
  await copy("Transaction", () => source.transaction.findMany(), (d) => dest.transaction.createMany({ data: d, skipDuplicates: true }));
  await copy("CreditSale", () => source.creditSale.findMany(), (d) => dest.creditSale.createMany({ data: d, skipDuplicates: true }));
  await copy("CreditPayment", () => source.creditPayment.findMany(), (d) => dest.creditPayment.createMany({ data: d, skipDuplicates: true }));
  await copy("ExpensePurchase", () => source.expensePurchase.findMany(), (d) => dest.expensePurchase.createMany({ data: d, skipDuplicates: true }));
  await copy("ExpensePayment", () => source.expensePayment.findMany(), (d) => dest.expensePayment.createMany({ data: d, skipDuplicates: true }));
  await copy("VehicleFuelFill", () => source.vehicleFuelFill.findMany(), (d) => dest.vehicleFuelFill.createMany({ data: d, skipDuplicates: true }));
  await copy("CorrectionRequest", () => source.correctionRequest.findMany(), (d) => dest.correctionRequest.createMany({ data: d, skipDuplicates: true }));
  await copy("AuditLog", () => source.auditLog.findMany(), (d) => dest.auditLog.createMany({ data: d, skipDuplicates: true }));
  await copy("PushDevice", () => source.pushDevice.findMany(), (d) => dest.pushDevice.createMany({ data: d, skipDuplicates: true }));
  await copy("AppNotification", () => source.appNotification.findMany(), (d) => dest.appNotification.createMany({ data: d, skipDuplicates: true }));
  await copy("FuelPriceSnapshot", () => source.fuelPriceSnapshot.findMany(), (d) => dest.fuelPriceSnapshot.createMany({ data: d, skipDuplicates: true }));

  const users = await dest.user.count();
  const txs = await dest.transaction.count();
  console.log(`DONE dest users=${users} transactions=${txs}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await source.$disconnect();
    await dest.$disconnect();
  });

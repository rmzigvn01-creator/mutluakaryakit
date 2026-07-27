-- CreateTable
CREATE TABLE "CompanyVehicle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompanyVehicle_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VehicleFuelFill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "transactionId" TEXT,
    "amount" REAL NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VehicleFuelFill_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "CompanyVehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VehicleFuelFill_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enteredAmount" REAL NOT NULL,
    "receiptAmount" REAL,
    "receiptDateTime" DATETIME,
    "amountDiff" REAL,
    "description" TEXT,
    "receiptPath" TEXT,
    "isCredit" BOOLEAN NOT NULL DEFAULT false,
    "customerId" TEXT,
    "isCompanyVehicle" BOOLEAN NOT NULL DEFAULT false,
    "vehicleId" TEXT,
    "suspicionStatus" TEXT NOT NULL DEFAULT 'PENDING_OCR',
    "suspicionNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "shiftId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'SYNCED',
    "deviceInfo" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "CompanyVehicle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("amountDiff", "clientId", "createdAt", "createdById", "customerId", "description", "deviceInfo", "enteredAmount", "id", "isCredit", "isDeleted", "receiptAmount", "receiptDateTime", "receiptPath", "reviewedAt", "reviewedById", "shiftId", "stationId", "suspicionNote", "suspicionStatus", "syncStatus", "type", "updatedAt") SELECT "amountDiff", "clientId", "createdAt", "createdById", "customerId", "description", "deviceInfo", "enteredAmount", "id", "isCredit", "isDeleted", "receiptAmount", "receiptDateTime", "receiptPath", "reviewedAt", "reviewedById", "shiftId", "stationId", "suspicionNote", "suspicionStatus", "syncStatus", "type", "updatedAt" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_clientId_key" ON "Transaction"("clientId");
CREATE INDEX "Transaction_stationId_createdAt_idx" ON "Transaction"("stationId", "createdAt");
CREATE INDEX "Transaction_createdById_createdAt_idx" ON "Transaction"("createdById", "createdAt");
CREATE INDEX "Transaction_suspicionStatus_idx" ON "Transaction"("suspicionStatus");
CREATE INDEX "Transaction_shiftId_idx" ON "Transaction"("shiftId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CompanyVehicle_stationId_plate_idx" ON "CompanyVehicle"("stationId", "plate");

-- CreateIndex
CREATE INDEX "CompanyVehicle_stationId_isActive_idx" ON "CompanyVehicle"("stationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleFuelFill_transactionId_key" ON "VehicleFuelFill"("transactionId");

-- CreateIndex
CREATE INDEX "VehicleFuelFill_vehicleId_createdAt_idx" ON "VehicleFuelFill"("vehicleId", "createdAt");

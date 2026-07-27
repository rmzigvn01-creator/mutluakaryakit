-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "closingNote" TEXT,
    CONSTRAINT "Shift_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Shift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "amountDiff" REAL,
    "description" TEXT,
    "receiptPath" TEXT,
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
    CONSTRAINT "Transaction_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("amountDiff", "clientId", "createdAt", "createdById", "description", "deviceInfo", "enteredAmount", "id", "isDeleted", "receiptAmount", "receiptPath", "reviewedAt", "reviewedById", "stationId", "suspicionNote", "suspicionStatus", "syncStatus", "type", "updatedAt") SELECT "amountDiff", "clientId", "createdAt", "createdById", "description", "deviceInfo", "enteredAmount", "id", "isDeleted", "receiptAmount", "receiptPath", "reviewedAt", "reviewedById", "stationId", "suspicionNote", "suspicionStatus", "syncStatus", "type", "updatedAt" FROM "Transaction";
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
CREATE INDEX "Shift_stationId_startedAt_idx" ON "Shift"("stationId", "startedAt");

-- CreateIndex
CREATE INDEX "Shift_userId_status_idx" ON "Shift"("userId", "status");

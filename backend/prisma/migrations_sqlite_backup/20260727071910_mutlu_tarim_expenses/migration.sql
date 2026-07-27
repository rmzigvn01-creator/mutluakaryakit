-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Supplier_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExpensePurchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExpensePurchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExpensePayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExpensePayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Supplier_stationId_name_idx" ON "Supplier"("stationId", "name");

-- CreateIndex
CREATE INDEX "Supplier_stationId_isActive_idx" ON "Supplier"("stationId", "isActive");

-- CreateIndex
CREATE INDEX "ExpensePurchase_supplierId_createdAt_idx" ON "ExpensePurchase"("supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "ExpensePayment_supplierId_createdAt_idx" ON "ExpensePayment"("supplierId", "createdAt");

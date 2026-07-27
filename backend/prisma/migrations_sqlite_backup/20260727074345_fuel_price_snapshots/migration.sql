-- CreateTable
CREATE TABLE "FuelPriceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cityId" TEXT NOT NULL,
    "cityName" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "districtName" TEXT NOT NULL,
    "benzin" REAL NOT NULL,
    "motorin" REAL NOT NULL,
    "gazyagi" REAL,
    "kalorifer" REAL,
    "fuelOil" REAL,
    "lpg" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'petrolofisi',
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "FuelPriceSnapshot_districtId_fetchedAt_idx" ON "FuelPriceSnapshot"("districtId", "fetchedAt");

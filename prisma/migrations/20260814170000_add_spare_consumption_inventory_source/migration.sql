-- ==========================================================
-- Spare Consumption Inventory Source
-- Safe migration for existing SpareConsumption records
-- ==========================================================

ALTER TABLE "SpareConsumption"
ADD COLUMN "warehouseId" TEXT,
ADD COLUMN "warehouseBinId" TEXT,
ADD COLUMN "batchId" TEXT,
ADD COLUMN "serialId" TEXT;

UPDATE "SpareConsumption"
SET "warehouseId" = '75312344-512a-423b-a258-3402908cfbf7'
WHERE "warehouseId" IS NULL;

ALTER TABLE "SpareConsumption"
ALTER COLUMN "warehouseId" SET NOT NULL;

CREATE INDEX "SpareConsumption_engineerVisitId_idx"
ON "SpareConsumption"("engineerVisitId");

CREATE INDEX "SpareConsumption_inventoryItemId_idx"
ON "SpareConsumption"("inventoryItemId");

CREATE INDEX "SpareConsumption_warehouseId_idx"
ON "SpareConsumption"("warehouseId");

CREATE INDEX "SpareConsumption_warehouseBinId_idx"
ON "SpareConsumption"("warehouseBinId");

CREATE INDEX "SpareConsumption_batchId_idx"
ON "SpareConsumption"("batchId");

CREATE INDEX "SpareConsumption_serialId_idx"
ON "SpareConsumption"("serialId");

ALTER TABLE "SpareConsumption"
ADD CONSTRAINT "SpareConsumption_warehouseId_fkey"
FOREIGN KEY ("warehouseId")
REFERENCES "Warehouse"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "SpareConsumption"
ADD CONSTRAINT "SpareConsumption_warehouseBinId_fkey"
FOREIGN KEY ("warehouseBinId")
REFERENCES "WarehouseBin"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

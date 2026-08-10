-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseZone" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseRack" (
    "id" TEXT NOT NULL,
    "warehouseZoneId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseRack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseBin" (
    "id" TEXT NOT NULL,
    "warehouseRackId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "capacityQty" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseBin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "warehouseBinId" TEXT,
    "batchId" TEXT,
    "serialId" TEXT,
    "quantityOnHand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantityReserved" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantityAvailable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantityBlocked" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantityDamaged" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageUnitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBatch" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "manufacturingDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "supplierBatchNo" TEXT,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantityReceived" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySerial" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "batchId" TEXT,
    "serialNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "receivedDate" TIMESTAMP(3),
    "issuedDate" TIMESTAMP(3),
    "warrantyStart" TIMESTAMP(3),
    "warrantyEnd" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySerial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "movementStatus" TEXT NOT NULL DEFAULT 'POSTED',
    "inventoryItemId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "sourceBinId" TEXT,
    "destinationBinId" TEXT,
    "batchId" TEXT,
    "serialId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,
    "referenceModule" TEXT,
    "referenceId" TEXT,
    "remarks" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE INDEX "WarehouseZone_warehouseId_idx" ON "WarehouseZone"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseZone_warehouseId_code_key" ON "WarehouseZone"("warehouseId", "code");

-- CreateIndex
CREATE INDEX "WarehouseRack_warehouseZoneId_idx" ON "WarehouseRack"("warehouseZoneId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseRack_warehouseZoneId_code_key" ON "WarehouseRack"("warehouseZoneId", "code");

-- CreateIndex
CREATE INDEX "WarehouseBin_warehouseRackId_idx" ON "WarehouseBin"("warehouseRackId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseBin_warehouseRackId_code_key" ON "WarehouseBin"("warehouseRackId", "code");

-- CreateIndex
CREATE INDEX "InventoryBalance_inventoryItemId_idx" ON "InventoryBalance"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryBalance_warehouseId_idx" ON "InventoryBalance"("warehouseId");

-- CreateIndex
CREATE INDEX "InventoryBalance_warehouseBinId_idx" ON "InventoryBalance"("warehouseBinId");

-- CreateIndex
CREATE INDEX "InventoryBalance_batchId_idx" ON "InventoryBalance"("batchId");

-- CreateIndex
CREATE INDEX "InventoryBalance_serialId_idx" ON "InventoryBalance"("serialId");

-- CreateIndex
CREATE INDEX "InventoryBatch_inventoryItemId_idx" ON "InventoryBatch"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryBatch_batchNumber_idx" ON "InventoryBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "InventoryBatch_expiryDate_idx" ON "InventoryBatch"("expiryDate");

-- CreateIndex
CREATE INDEX "InventoryBatch_status_idx" ON "InventoryBatch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBatch_inventoryItemId_batchNumber_key" ON "InventoryBatch"("inventoryItemId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InventorySerial_serialNumber_key" ON "InventorySerial"("serialNumber");

-- CreateIndex
CREATE INDEX "InventorySerial_inventoryItemId_idx" ON "InventorySerial"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventorySerial_batchId_idx" ON "InventorySerial"("batchId");

-- CreateIndex
CREATE INDEX "InventorySerial_status_idx" ON "InventorySerial"("status");

-- CreateIndex
CREATE INDEX "InventoryMovement_inventoryItemId_idx" ON "InventoryMovement"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryMovement_warehouseId_idx" ON "InventoryMovement"("warehouseId");

-- CreateIndex
CREATE INDEX "InventoryMovement_sourceBinId_idx" ON "InventoryMovement"("sourceBinId");

-- CreateIndex
CREATE INDEX "InventoryMovement_destinationBinId_idx" ON "InventoryMovement"("destinationBinId");

-- CreateIndex
CREATE INDEX "InventoryMovement_batchId_idx" ON "InventoryMovement"("batchId");

-- CreateIndex
CREATE INDEX "InventoryMovement_serialId_idx" ON "InventoryMovement"("serialId");

-- CreateIndex
CREATE INDEX "InventoryMovement_movementType_idx" ON "InventoryMovement"("movementType");

-- CreateIndex
CREATE INDEX "InventoryMovement_referenceModule_referenceId_idx" ON "InventoryMovement"("referenceModule", "referenceId");

-- CreateIndex
CREATE INDEX "InventoryMovement_createdAt_idx" ON "InventoryMovement"("createdAt");

-- AddForeignKey
ALTER TABLE "WarehouseZone" ADD CONSTRAINT "WarehouseZone_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseRack" ADD CONSTRAINT "WarehouseRack_warehouseZoneId_fkey" FOREIGN KEY ("warehouseZoneId") REFERENCES "WarehouseZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseBin" ADD CONSTRAINT "WarehouseBin_warehouseRackId_fkey" FOREIGN KEY ("warehouseRackId") REFERENCES "WarehouseRack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_warehouseBinId_fkey" FOREIGN KEY ("warehouseBinId") REFERENCES "WarehouseBin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_serialId_fkey" FOREIGN KEY ("serialId") REFERENCES "InventorySerial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySerial" ADD CONSTRAINT "InventorySerial_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySerial" ADD CONSTRAINT "InventorySerial_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_sourceBinId_fkey" FOREIGN KEY ("sourceBinId") REFERENCES "WarehouseBin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_destinationBinId_fkey" FOREIGN KEY ("destinationBinId") REFERENCES "WarehouseBin"("id") ON DELETE SET NULL ON UPDATE CASCADE;


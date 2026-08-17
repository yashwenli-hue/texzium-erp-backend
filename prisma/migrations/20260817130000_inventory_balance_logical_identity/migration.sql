-- InventoryBalance logical identity
--
-- PostgreSQL-specific:
-- NULLS NOT DISTINCT ensures that NULL batchId/serialId/warehouseBinId
-- values participate in uniqueness rather than allowing duplicate
-- logical balance rows.

CREATE UNIQUE INDEX "InventoryBalance_logical_identity_key"
ON "InventoryBalance"
(
    "inventoryItemId",
    "warehouseId",
    "warehouseBinId",
    "batchId",
    "serialId"
)
NULLS NOT DISTINCT;


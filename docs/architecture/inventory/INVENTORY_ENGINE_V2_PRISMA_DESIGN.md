# TEXZIUM ERP

# Inventory Engine V2 — Final Prisma Design

Version: 1.0
Status: Architecture Design
Branch: inventory-engine-v2

---

# 1. Purpose

This document defines the final database model required by Inventory Engine V2.

The V2 database design introduces dedicated inventory authorities while preserving
existing business-module models for compatibility.

No production inventory data is modified by this design document.

---

# 2. Authority Model

# InventoryItem

Product / inventory identity

# Warehouse

Physical warehouse master

# WarehouseZone

Warehouse zone

# WarehouseRack

Rack within a zone

# WarehouseBin

Physical storage bin

# InventoryBalance

Current inventory quantity authority

# InventoryMovement

Physical inventory movement authority

# InventoryReservation

Reservation authority

# InventoryBatch

Batch traceability authority

# InventorySerial

Serial traceability authority

# InventoryLedger

Inventory valuation/history authority

# InventoryCostLayer

Cost-layer authority

# StockCount

Physical stock verification authority

# StockVariance

Stock discrepancy authority

# InventoryAdjustment

Approved inventory adjustment authority

# AuditLog

System audit authority

---

# 3. Warehouse Model

Model: Warehouse

Purpose:

Represents a physical or logical inventory warehouse.

Core fields:

* id
* code
* name
* description
* status
* address
* createdAt
* updatedAt

Rules:

* code must be unique
* inactive warehouses cannot receive new inventory
* warehouse belongs to the current company/tenant context
* warehouse is the parent of zones

Relationships:

Warehouse
→ WarehouseZone[]
→ InventoryBalance[]
→ InventoryMovement[]

---

# 4. WarehouseZone

Model: WarehouseZone

Purpose:

Represents a logical zone inside a warehouse.

Fields:

* id
* warehouseId
* code
* name
* status
* createdAt
* updatedAt

Rules:

Unique:

warehouseId + code

Relationships:

Warehouse
→ WarehouseZone[]

WarehouseZone
→ WarehouseRack[]

---

# 5. WarehouseRack

Model: WarehouseRack

Purpose:

Represents a rack inside a warehouse zone.

Fields:

* id
* warehouseZoneId
* code
* name
* status
* createdAt
* updatedAt

Rules:

Unique:

warehouseZoneId + code

---

# 6. WarehouseBin

Model: WarehouseBin

Purpose:

Represents the smallest physical storage location.

Fields:

* id
* warehouseRackId
* code
* name
* status
* capacityQty
* createdAt
* updatedAt

Rules:

Unique:

warehouseRackId + code

Relationships:

WarehouseRack
→ WarehouseBin[]

WarehouseBin
→ InventoryBalance[]

WarehouseBin
→ InventoryMovement[]

---

# 7. InventoryBalance

Model: InventoryBalance

Purpose:

Current quantity authority.

This model replaces InventoryItem.stockQty,
InventoryItem.reservedQty and InventoryItem.availableQty
as the authoritative live quantity source.

Fields:

* id
* inventoryItemId
* warehouseId
* warehouseBinId
* batchId
* quantityOnHand
* quantityReserved
* quantityAvailable
* quantityBlocked
* quantityDamaged
* averageUnitCost
* createdAt
* updatedAt

Formula:

quantityAvailable =
quantityOnHand

* quantityReserved
* quantityBlocked
* quantityDamaged

Rules:

* quantityOnHand cannot become negative unless explicitly allowed by configuration
* quantityReserved cannot exceed quantityOnHand
* quantityAvailable cannot become negative
* every balance change must originate from InventoryMovement
* direct application-level quantity mutation is prohibited

Unique balance identity:

inventoryItemId
+
warehouseBinId
+
batchId

For serialized inventory, serial identity is handled by InventorySerial.

---

# 8. InventoryMovement

Model: InventoryMovement

Purpose:

Authoritative physical inventory movement record.

Examples:

* RECEIVE
* PUTAWAY
* RESERVE
* RELEASE
* PICK
* PACK
* ISSUE
* TRANSFER
* RETURN
* ADJUSTMENT
* DAMAGE
* SCRAP
* QC_HOLD
* QC_RELEASE

Fields:

* id
* inventoryItemId
* warehouseId
* fromBinId
* toBinId
* batchId
* serialId
* movementType
* quantity
* unitCost
* referenceModule
* referenceId
* referenceLineId
* remarks
* createdBy
* createdAt

Rules:

InventoryMovement is immutable after creation.

Corrections must use reversing/corrective movements.

---

# 9. InventoryReservation

Existing InventoryReservation remains for compatibility.

V2 reservation authority must connect to InventoryBalance.

Existing salesOrderId remains supported.

Additional V2 relationships may include:

* inventoryBalanceId
* dispatchOrderItemId
* reservationStatus
* reservedAt
* releasedAt

Reservation lifecycle:

REQUESTED
→ RESERVED
→ PARTIALLY_RELEASED
→ RELEASED
→ EXPIRED
→ CANCELLED

Reservation must not directly manipulate InventoryItem quantities.

---

# 10. InventoryBatch

Model: InventoryBatch

Purpose:

Batch identity and traceability.

Fields:

* id
* inventoryItemId
* batchNumber
* manufacturingDate
* expiryDate
* supplierBatchNumber
* status
* createdAt
* updatedAt

Rules:

Unique:

inventoryItemId + batchNumber

Batch stock is represented through InventoryBalance.

Batch movement is represented through InventoryMovement.

---

# 11. InventorySerial

Model: InventorySerial

Purpose:

Individual serialized inventory identity.

Fields:

* id
* inventoryItemId
* serialNumber
* batchId
* status
* currentWarehouseId
* currentBinId
* receivedAt
* issuedAt
* createdAt
* updatedAt

Rules:

serialNumber must be unique.

A serialized inventory item represents one physical unit.

Serial movement must be traceable through InventoryMovement.

---

# 12. InventoryLedger

Model: InventoryLedger

Purpose:

Immutable historical inventory valuation and quantity ledger.

Fields:

* id
* inventoryItemId
* warehouseId
* batchId
* serialId
* movementId
* quantity
* unitCost
* totalCost
* balanceQuantity
* balanceValue
* referenceModule
* referenceId
* createdAt

Rules:

Ledger entries are immutable.

InventoryLedger is not the FinanceOS accounting ledger.

FinanceOS remains responsible for accounting entries.

---

# 13. InventoryCostLayer

Model: InventoryCostLayer

Purpose:

Maintains inventory costing layers.

Supports:

* FIFO
* LIFO
* Weighted Average

Fields:

* id
* inventoryItemId
* warehouseId
* batchId
* movementId
* originalQuantity
* remainingQuantity
* unitCost
* totalCost
* createdAt
* updatedAt

Cost consumption must reduce remainingQuantity.

Consumed cost layers must remain historically traceable.

---

# 14. StockCount

Model: StockCount

Purpose:

Physical stock counting session.

Fields:

* id
* countNumber
* warehouseId
* status
* countDate
* initiatedBy
* approvedBy
* remarks
* createdAt
* updatedAt

Lifecycle:

DRAFT
→ IN_PROGRESS
→ SUBMITTED
→ UNDER_REVIEW
→ APPROVED
→ POSTED
→ CLOSED

---

# 15. StockCountLine

Model: StockCountLine

Purpose:

Individual inventory count line.

Fields:

* id
* stockCountId
* inventoryItemId
* warehouseBinId
* batchId
* serialId
* systemQuantity
* countedQuantity
* varianceQuantity
* remarks
* createdAt
* updatedAt

Formula:

varianceQuantity =
countedQuantity - systemQuantity

---

# 16. StockVariance

Model: StockVariance

Purpose:

Represents an investigated physical stock discrepancy.

Fields:

* id
* stockCountLineId
* varianceQuantity
* varianceType
* reason
* investigationStatus
* investigatedBy
* approvedBy
* remarks
* createdAt
* updatedAt

Variance types may include:

SHORTAGE
EXCESS
DAMAGE
MISPLACED
UNKNOWN

---

# 17. InventoryAdjustment

Model: InventoryAdjustment

Purpose:

Approved stock correction request.

Fields:

* id
* adjustmentNumber
* warehouseId
* status
* reason
* requestedBy
* approvedBy
* postedBy
* remarks
* createdAt
* updatedAt

Lifecycle:

DRAFT
→ SUBMITTED
→ APPROVED
→ POSTED
→ CANCELLED

Posting an adjustment creates InventoryMovement.

InventoryAdjustment does not directly modify InventoryBalance.

---

# 18. Existing Model Compatibility

The following models remain:

* InventoryItem
* InventoryTransaction
* InventoryReservation
* WarehousePutaway
* ProductTag
* GoodsReceipt
* QualityInspection
* StockInspection
* SpareConsumption
* RMA
* Asset
* DispatchOrder
* DispatchOrderItem
* Warranty

They will be integrated with V2 rather than immediately deleted.

---

# 19. Legacy Quantity Fields

Existing:

InventoryItem.stockQty
InventoryItem.reservedQty
InventoryItem.availableQty

These fields become legacy compatibility fields.

Migration strategy:

Phase 1:
Create V2 InventoryBalance.

Phase 2:
Backfill InventoryBalance from existing InventoryItem quantities.

Phase 3:
Validate balances.

Phase 4:
Move all inventory operations to InventoryBalance.

Phase 5:
Stop writing legacy quantity fields.

Phase 6:
Remove legacy fields only after production validation.

---

# 20. Legacy InventoryTransaction

InventoryTransaction remains historical compatibility data.

New inventory movements use:

InventoryMovement

No new business operation should create an independent quantity authority through
InventoryTransaction.

---

# 21. Dispatch Integration

DispatchOrder and DispatchOrderItem remain business workflow records.

Inventory Engine controls:

Reserve
→ Pick
→ Pack
→ Issue
→ Dispatch

DispatchOrderItem stores workflow quantities.

InventoryBalance stores actual inventory quantities.

InventoryMovement stores physical movement history.

---

# 22. Receiving Integration

GoodsReceipt remains the receiving document.

QualityInspection remains the quality gate.

Accepted inventory follows:

GoodsReceipt
→ QualityInspection
→ RECEIVE / PUTAWAY
→ InventoryBalance

Rejected inventory follows the QC rejection workflow.

---

# 23. Spare Consumption Integration

SpareConsumption remains the service business record.

Inventory Engine performs:

ISSUE

The Inventory Engine determines:

* quantity
* movement
* balance
* inventory cost

SpareConsumption stores:

* quantityUsed
* calculated unitCost
* totalCost
* business reference

---

# 24. Serial Integration

Existing:

* ProductTag.serialNumber
* Warranty.serialNumber
* Asset.serialNumber
* DispatchOrderItem.serialNumber

remain business-level references.

InventorySerial becomes the inventory serial authority.

---

# 25. Batch Integration

Existing:

DispatchOrderItem.batchNumber

becomes a compatibility reference.

InventoryBatch becomes the authoritative batch entity.

---

# 26. Required Indexes

InventoryBalance:

* inventoryItemId
* warehouseId
* warehouseBinId
* batchId
* inventoryItemId + warehouseBinId + batchId

InventoryMovement:

* inventoryItemId
* warehouseId
* fromBinId
* toBinId
* batchId
* serialId
* movementType
* referenceModule + referenceId
* createdAt

InventoryLedger:

* inventoryItemId
* warehouseId
* batchId
* serialId
* movementId
* createdAt

InventoryCostLayer:

* inventoryItemId
* warehouseId
* batchId
* remainingQuantity

InventoryReservation:

* inventoryItemId
* salesOrderId
* dispatchOrderItemId
* status

---

# 27. Transaction Boundary

Inventory operations must use Prisma transactions.

Examples:

RECEIVE:

GoodsReceipt
+
InventoryMovement
+
InventoryBalance
+
InventoryLedger
+
CostLayer

RESERVE:

InventoryReservation
+
InventoryBalance
+
InventoryMovement

ISSUE:

InventoryMovement
+
InventoryBalance
+
InventoryLedger
+
CostLayer

ADJUSTMENT:

InventoryAdjustment
+
InventoryMovement
+
InventoryBalance
+
InventoryLedger

---

# 28. Core Rule

No OperationsOS business service may directly modify:

InventoryBalance.quantityOnHand
InventoryBalance.quantityReserved
InventoryBalance.quantityAvailable

outside the Inventory Engine transaction boundary.

The Inventory Engine is the sole authority for inventory quantity changes.

---

# 29. Implementation Sequence

1. Add V2 enums.
2. Add Warehouse hierarchy.
3. Add InventoryBatch.
4. Add InventorySerial.
5. Add InventoryBalance.
6. Add InventoryMovement.
7. Add InventoryLedger.
8. Add InventoryCostLayer.
9. Add StockCount.
10. Add StockCountLine.
11. Add StockVariance.
12. Add InventoryAdjustment.
13. Add compatibility relations.
14. Validate Prisma schema.
15. Create migration.
16. Generate Prisma Client.
17. Implement Balance Engine.
18. Implement Movement Engine.
19. Implement Reservation Engine.
20. Implement Receiving Engine.
21. Implement Transfer Engine.
22. Implement Issue Engine.
23. Implement Stock Audit Engine.
24. Integrate Dispatch.
25. Integrate Procurement.
26. Integrate Service.
27. Integrate RMA.
28. Run integration tests.

---

# 30. Database Safety Rule

Before any production migration:

* database backup required
* schema validation required
* migration SQL review required
* existing quantity reconciliation required
* rollback strategy required

No production inventory data may be altered until the V2 migration has been
validated.

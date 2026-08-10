# TEXZIUM ERP
# Inventory Engine V2 — Existing → V2 Model Mapping

Version: 1.0
Status: Architecture Mapping
Branch: inventory-engine-v2

---

# 1. Purpose

This document maps the existing TEXZIUM ERP inventory-related database models to
the Inventory Engine V2 architecture.

No existing model is to be deleted during the initial V2 implementation.

The V2 Inventory Engine becomes the authoritative inventory quantity and movement
engine while existing business modules remain responsible for their own business
documents and workflows.

---

# 2. Existing Inventory Models

## 2.1 InventoryItem

Existing model:

InventoryItem

Current responsibilities:

- SKU
- Product name
- Category
- HSN reference
- Stock quantity
- Reserved quantity
- Available quantity
- Legacy warehouse reference
- Condition
- Warranty configuration
- Relationships to inspections
- Reservations
- Purchase requisitions
- Spare consumption
- Sales orders
- Putaways
- Product tags
- Transactions

V2 decision:

KEEP + EVOLVE

InventoryItem remains the existing ERP inventory/product identity record.

V2 quantity authority must move to InventoryBalance.

The following fields are therefore considered legacy quantity fields:

- stockQty
- reservedQty
- availableQty
- warehouse

They must not become competing sources of truth after V2 migration.

---

# 3. Inventory Balance

V2 authority:

InventoryBalance

Responsibility:

- Current physical quantity
- Reserved quantity
- Available quantity
- Warehouse/location quantity
- Batch quantity
- Serial-aware quantity

Authority rule:

InventoryBalance is the current inventory quantity authority.

Relationship:

InventoryItem
    ↓
InventoryBalance
    ↓
Warehouse / Location
    ↓
Batch / Serial where applicable

Existing InventoryItem remains the parent identity record.

---

# 4. InventoryTransaction

Existing model:

InventoryTransaction

Current responsibilities:

- Inventory quantity movement history
- Warehouse reference
- Bin reference
- Transaction type
- Reference module
- Reference record
- Quantity
- Balance after
- Remarks
- Created by
- Created timestamp

V2 decision:

LEGACY COMPATIBILITY → SUPERSEDE WITH INVENTORY MOVEMENT

V2 replacement authority:

InventoryMovement

InventoryMovement becomes the physical inventory movement authority.

Existing InventoryTransaction must remain during migration for historical
compatibility.

New V2 business operations must not create competing inventory quantity logic
outside InventoryMovement.

---

# 5. Inventory Ledger

V2 model:

InventoryLedger

Responsibility:

- Immutable inventory valuation history
- Quantity ledger
- Valuation ledger
- Cost references
- Costing history
- Inventory valuation traceability

Authority:

InventoryLedger is the historical valuation authority.

FinanceOS remains the financial accounting authority.

InventoryLedger must not replace FinanceOS accounting entries.

---

# 6. Cost Layers

V2 model:

InventoryCostLayer

Responsibility:

- Receipt cost
- FIFO layers
- Weighted-average costing support
- LIFO support where configured
- Layer consumption
- Batch cost
- Serial cost
- Transfer cost
- Landed cost adjustments
- Vendor bill cost adjustments

Existing SpareConsumption.unitCost is NOT the inventory valuation authority.

SpareConsumption must obtain inventory issue cost from the Inventory Engine.

---

# 7. Inventory Reservation

Existing model:

InventoryReservation

Current responsibilities:

- Inventory item
- Sales order
- Reserved quantity
- Reservation status
- Reservation type
- Expiry
- Priority
- Remarks

V2 decision:

KEEP + EVOLVE

The existing model remains for compatibility.

V2 reservation operations must follow the V2 Reservation Engine.

Reservation must affect InventoryBalance.

Reservation must not independently manipulate stock quantities outside the
Inventory Engine.

---

# 8. Warehouse

Existing warehouse representation is legacy-only.

Current representations include:

- InventoryItem.warehouse
- InventoryTransaction.warehouseId
- DispatchOrder.warehouseId
- WarehousePutaway.warehouseName

No dedicated Warehouse model currently exists.

V2 decision:

CREATE

V2 Warehouse becomes the master warehouse entity.

---

# 9. Warehouse Location

Current legacy location information exists inside:

WarehousePutaway:

- warehouseName
- zoneName
- rackNumber
- binNumber

InventoryTransaction:

- warehouseId
- binLocation

DispatchOrderItem:

- warehouseId
- binLocation

V2 decision:

CREATE DEDICATED LOCATION HIERARCHY

Target hierarchy:

Warehouse
    ↓
Zone
    ↓
Rack
    ↓
Bin

The V2 location hierarchy becomes the authoritative physical inventory location.

Legacy location fields remain temporarily for compatibility.

---

# 10. WarehousePutaway

Existing model:

WarehousePutaway

Current responsibilities:

- Quality inspection reference
- Inventory item
- Warehouse name
- Zone
- Rack
- Bin
- Putaway quantity
- Putaway status

V2 decision:

KEEP + INTEGRATE

WarehousePutaway remains the business receiving/putaway document.

It must call Inventory Engine movement logic when stock is physically put away.

It must not directly become the inventory quantity authority.

---

# 11. Batch Traceability

Current schema:

No dedicated InventoryBatch model exists.

DispatchOrderItem currently contains:

batchNumber

V2 decision:

CREATE InventoryBatch

InventoryBatch becomes the authoritative batch identity and traceability record.

Batch stock must connect to InventoryBalance.

Batch movements must connect to InventoryMovement.

Batch valuation must connect to InventoryLedger / Cost Layers.

---

# 12. Serial Traceability

Current serial information exists in:

Warranty.serialNumber

Asset.serialNumber

ProductTag.serialNumber

DispatchOrderItem.serialNumber

No dedicated InventorySerial model exists.

V2 decision:

CREATE InventorySerial

InventorySerial becomes the authoritative inventory serial record.

Existing:

- ProductTag
- Warranty
- Asset
- DispatchOrderItem

remain business-module records and integrate with InventorySerial.

They must not become competing inventory serial authorities.

---

# 13. ProductTag

Existing model:

ProductTag

Current responsibilities:

- Inventory item
- Sales order
- Customer
- Salesperson
- Serial number
- QR code
- Tag status
- Dispatch status
- Warranty status

V2 decision:

KEEP + INTEGRATE

ProductTag remains a business/traceability document.

Serial authority moves to InventorySerial.

---

# 14. Warranty

Existing model:

Warranty

Current responsibilities:

- Sales invoice
- Serial number
- Warranty dates
- Warranty status

V2 decision:

KEEP + INTEGRATE

Warranty must reference the appropriate serialized inventory identity through
the V2 serial architecture.

Warranty remains a business lifecycle record.

---

# 15. Asset

Existing model:

Asset

Current responsibilities:

- Serial number
- Sales invoice
- Product
- Installation
- Asset status
- Health score

V2 decision:

KEEP + INTEGRATE

Asset remains the fixed-asset / installed-asset business record.

InventorySerial remains the inventory traceability authority.

---

# 16. SpareConsumption

Existing model:

SpareConsumption

Current fields include:

- inventoryItemId
- quantityUsed
- unitCost
- totalCost

V2 decision:

KEEP + INTEGRATE

Spare consumption becomes an Inventory Engine ISSUE consumer.

It must not directly reduce InventoryItem.stockQty.

The Inventory Engine determines:

- quantity issued
- inventory movement
- inventory balance
- issue cost
- ledger entry

SpareConsumption stores the business-level consumption record.

---

# 17. GoodsReceipt

Existing model:

GoodsReceipt

Current responsibilities:

- Purchase order
- GRN number
- Received quantity
- Remarks
- Quality inspection relationship
- Vendor bill relationship

V2 decision:

KEEP + INTEGRATE

GoodsReceipt remains the procurement receiving document.

Receiving stock must use the Inventory Engine RECEIVE operation.

GoodsReceipt must not independently become the inventory quantity authority.

---

# 18. QualityInspection

Existing model:

QualityInspection

Current responsibilities:

- Goods receipt
- Accepted quantity
- Rejected quantity
- QC status
- Inspector
- Remarks

V2 decision:

KEEP + INTEGRATE

QualityInspection remains the quality gate.

Accepted inventory can proceed to the appropriate inventory movement / putaway flow.

Rejected inventory must follow the defined QC/rejection workflow.

---

# 19. StockInspection

Existing model:

StockInspection

Current responsibilities:

- Inventory item
- Sales order
- Inspection date
- Condition
- Treatment jobs

V2 decision:

KEEP

StockInspection is not the same as StockCount.

StockInspection remains an operational inspection record.

StockCount is the V2 physical stock verification authority.

---

# 20. DispatchOrder

Existing model:

DispatchOrder

Current responsibilities include:

- Customer
- Sales order
- Warehouse
- Logistics
- Approval
- Gate pass
- Invoice
- E-invoice
- E-way bill
- Dispatch status

V2 decision:

KEEP + INTEGRATE

DispatchOrder remains the business dispatch document.

Inventory Engine controls the inventory side of:

- reservation
- pick
- pack
- issue
- dispatch movement

---

# 21. DispatchOrderItem

Existing model:

DispatchOrderItem

Current inventory fields:

- inventoryItemId
- reservedQty
- pickedQty
- packedQty
- dispatchedQty
- warehouseId
- binLocation
- serialNumber
- batchNumber
- workflow flags

V2 decision:

KEEP + INTEGRATE

DispatchOrderItem remains the dispatch workflow record.

Inventory Engine becomes authoritative for actual inventory movement.

DispatchOrderItem quantities are workflow/document quantities and must not
become an independent inventory balance.

---

# 22. Stock Audit

V2 models:

StockCount
StockCountLine
StockCountResult
StockVariance
StockInvestigation
InventoryAdjustment

V2 decisions:

CREATE

These models do not currently exist in the Prisma schema.

Authority:

StockCount
= physical verification authority

StockVariance
= discrepancy authority

InventoryMovement
= physical adjustment authority

InventoryBalance
= current quantity authority

InventoryLedger
= historical valuation authority

---

# 23. Inventory Adjustment

V2 model:

InventoryAdjustment

Decision:

CREATE

Adjustment workflow:

Stock Count
    ↓
Variance
    ↓
Investigation
    ↓
Approval
    ↓
InventoryAdjustment
    ↓
InventoryMovement
    ↓
InventoryBalance
    ↓
InventoryLedger

No stock adjustment may directly modify quantity fields without passing through
the Inventory Engine.

---

# 24. Legacy Quantity Fields

The following existing fields are legacy quantity authorities:

InventoryItem.stockQty
InventoryItem.reservedQty
InventoryItem.availableQty

V2 authority:

InventoryBalance

Migration principle:

Do not immediately delete legacy fields.

First migrate all inventory operations to InventoryBalance.

Then validate historical and live quantity consistency.

Only after migration validation should legacy quantity fields be deprecated.

---

# 25. Legacy InventoryTransaction

InventoryTransaction remains available for historical compatibility.

V2 operations use:

InventoryMovement

InventoryTransaction must not become a second physical movement authority.

Migration should preserve historical transaction records.

---

# 26. Cross-Module Ownership

RevenueOS:

Creates demand / dispatch requirements.

ProcurementOS:

Creates receiving demand.

WarehouseOS:

Operates warehouse processes.

ProductionOS:

Consumes and produces inventory.

ServiceOS:

Consumes spare inventory.

RMAOS:

Creates return requirements.

AssetOS:

Consumes serialized inventory into installed assets.

WarrantyOS:

Tracks serialized warranty lifecycle.

Inventory Engine:

Owns physical inventory quantity and movement.

FinanceOS:

Owns financial accounting.

DocumentOS:

Owns inventory-related documents.

AdminOS:

Owns permissions, approvals, configuration and controls.

---

# 27. Final Authority Model

InventoryItem
=
inventory/product identity

InventoryBalance
=
current inventory quantity authority

InventoryMovement
=
physical inventory movement authority

InventoryReservation
=
reservation authority

InventoryLedger
=
historical inventory valuation authority

InventoryCostLayer
=
cost-layer authority

InventoryBatch
=
batch traceability authority

InventorySerial
=
serial traceability authority

StockCount
=
physical verification authority

StockVariance
=
discrepancy authority

InventoryAdjustment
=
approved adjustment request

AuditLog
=
system audit authority

FinanceOS
=
financial accounting authority

---

# 28. Implementation Rule

The V2 implementation must NOT:

- delete legacy inventory models immediately
- directly modify stock quantities from business modules
- create duplicate warehouse authorities
- create duplicate serial authorities
- create duplicate batch authorities
- allow Stock Audit to bypass Inventory Engine
- allow FinanceOS to become physical inventory authority

---

# 29. Next Implementation Phase

After this mapping is approved:

1. Finalize V2 Prisma models.
2. Add V2 enums.
3. Add foreign keys.
4. Add indexes.
5. Add unique constraints.
6. Add compatibility relations.
7. Create migration.
8. Generate Prisma Client.
9. Implement InventoryBalance service.
10. Implement InventoryMovement service.
11. Implement Reservation service.
12. Implement Ledger service.
13. Implement Cost Layer service.
14. Implement Stock Count / Reconciliation services.
15. Migrate existing Inventory Engine operations.
16. Run integration tests.

No production inventory data should be modified until the migration plan is
validated.

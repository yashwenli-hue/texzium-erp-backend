# TEXZIUM ERP
# Inventory Engine V2 — Prisma Schema Mapping

## 1. Purpose

This document maps the existing TEXZIUM ERP Prisma schema to the
Inventory Engine V2 architecture.

No existing database model should be deleted or replaced until its
relationships and existing production usage have been audited.

---

# 2. Existing Inventory Models

## 2.1 InventoryItem

Existing model:

InventoryItem

Current responsibility:

- Inventory item identity
- SKU
- Product name
- Category
- Stock quantity
- Reserved quantity
- Available quantity
- Warehouse reference
- Condition
- Warranty information

V2 decision:

MODIFY

Reason:

The existing model combines inventory identity and inventory balance.

V2 requires inventory balances to support:

- Warehouse
- Location
- Batch
- Serial
- Condition
- Quantity
- Reserved quantity
- Available quantity
- Cost
- Traceability

Existing InventoryItem should therefore be preserved as the
foundation and evolved carefully.

---

# 3. InventoryTransaction

Existing model:

InventoryTransaction

V2 decision:

MODIFY

Existing capabilities:

- Inventory item
- Warehouse
- Bin
- Transaction type
- Reference module
- Reference ID
- Quantity
- Balance after
- Created by
- Timestamp

V2 requirements to evaluate:

- Movement direction
- Source location
- Destination location
- Batch
- Serial
- Unit cost
- Total cost
- Cost layer
- Source document line
- Idempotency
- Reversal
- Audit relationship

The existing ledger must not be deleted.

It should be evolved into the V2 movement/ledger architecture.

---

# 4. InventoryReservation

Existing model:

InventoryReservation

V2 decision:

MODIFY

Current design is strongly tied to SalesOrder.

V2 reservations must support multiple consuming modules.

Potential references:

- Sales Order
- Dispatch Order
- Production Order
- Project
- Service Ticket
- Other approved inventory demand

The reservation architecture should therefore use a generic source
reference where appropriate.

---

# 5. DispatchOrder

Existing model:

DispatchOrder

V2 decision:

KEEP

DispatchOrder remains owned by the Dispatch workflow.

It must consume Inventory Engine services for inventory operations.

DispatchOrder must not become an independent inventory engine.

---

# 6. DispatchOrderItem

Existing model:

DispatchOrderItem

V2 decision:

MODIFY / INTEGRATE

Existing fields include:

- inventoryItemId
- quantity
- reservedQty
- pickedQty
- packedQty
- dispatchedQty
- warehouseId
- binLocation
- serialNumber
- batchNumber
- reservation status
- picking status
- packing status
- dispatch status

These fields may remain as workflow references.

Actual inventory state must be controlled by Inventory Engine.

---

# 7. Warehouse

Current audit status:

NO CONFIRMED DEDICATED WAREHOUSE MASTER

V2 decision:

CREATE

Required architecture:

Warehouse
    ↓
Zone
    ↓
Rack
    ↓
Bin / Location

The exact models will be finalized after confirming all existing
warehouse-related structures.

---

# 8. Warehouse Location

V2 decision:

CREATE / FINALIZE AFTER AUDIT

Required capabilities:

- Warehouse
- Zone
- Rack
- Bin
- Location code
- Location type
- Active status
- Capacity where required

Inventory must reference locations through UUID relationships rather
than relying primarily on free-text location fields.

---

# 9. Batch

Current audit status:

NO CONFIRMED DEDICATED INVENTORY BATCH MODEL

Existing batch references such as batchNumber must not be treated as
the final batch architecture.

V2 decision:

CREATE

Required capabilities:

- Batch identity
- Inventory item
- Batch number
- Manufacturing date
- Expiry date
- Supplier reference where applicable
- Status
- Quantity
- Traceability

---

# 10. Serial

Existing schema contains serialNumber fields and ProductTag-related
serial functionality.

V2 decision:

INVESTIGATE BEFORE CREATE

Do not create a duplicate Serial model until existing serial
relationships are completely understood.

The final V2 model must support:

- Unique serial identity
- Inventory item
- Warehouse
- Location
- Batch where applicable
- Status
- Receipt
- Issue
- Transfer
- Return
- Warranty reference
- Complete movement history

---

# 11. ProductTag

Existing model:

ProductTag

V2 decision:

KEEP / INTEGRATE

ProductTag appears to contain serialized product/tag information.

It must be determined whether ProductTag represents:

1. Serialized inventory identity

or

2. A physical/commercial tag associated with serialized inventory.

This decision must be made before introducing a new Serial model.

---

# 12. WarehousePutaway

Existing model:

WarehousePutaway

V2 decision:

MODIFY / INTEGRATE

Current warehouse, zone, rack and bin values appear to be represented
partially through fields.

V2 should use proper Warehouse and Location relationships.

WarehousePutaway remains responsible for putaway workflow.

Inventory Engine remains responsible for inventory state.

---

# 13. StockInspection

Existing model:

StockInspection

V2 decision:

KEEP SEPARATE

StockInspection is not automatically equivalent to Physical Stock
Count.

Stock Inspection and Stock Count have different responsibilities.

Stock Count V2 will be a separate controlled reconciliation workflow.

---

# 14. Stock Count

Current audit status:

NO CONFIRMED DEDICATED MODEL

V2 decision:

CREATE

Required models may include:

StockCount
StockCountLine
StockCountVariance

Exact model structure will be finalized before migration.

---

# 15. Inventory Cost Layer

Current audit status:

NO CONFIRMED DEDICATED MODEL

V2 decision:

CREATE

Required for:

- FIFO
- LIFO where enabled
- Average Cost
- Cost tracking
- Inventory valuation
- FinanceOS integration

Exact costing architecture must be finalized before implementation.

---

# 16. Inventory Adjustment

Current audit status:

NO CONFIRMED DEDICATED MODEL

V2 decision:

CREATE OR MODEL THROUGH INVENTORY MOVEMENT

Adjustments must never directly overwrite inventory quantities.

Every adjustment must generate an inventory movement and ledger entry.

---

# 17. Inventory Balance

Current architecture:

Inventory quantities are currently stored directly on InventoryItem.

V2 decision:

REDESIGN

Required balance dimensions may include:

Inventory Item
Warehouse
Location
Batch
Serial
Condition

Required quantities:

- On Hand
- Reserved
- Available

The final balance model must be designed before implementation.

---

# 18. Inventory Ledger

Existing InventoryTransaction provides the foundation.

V2 decision:

MODIFY / EVOLVE

The ledger must remain append-oriented.

Historical movement records must not be overwritten.

Every physical inventory movement must be explainable through the
ledger.

---

# 19. FinanceOS Integration

Inventory Engine provides:

- Quantity
- Movement
- Unit cost
- Total cost
- Inventory valuation information

FinanceOS owns:

- General Ledger
- Accounting entries
- Financial reporting
- Accounting periods

Inventory Engine must not duplicate FinanceOS accounting logic.

---

# 20. DocumentOS Integration

Inventory Engine stores document references.

DocumentOS owns:

- File storage
- Document lifecycle
- Document versions
- Document permissions

Inventory Engine should not duplicate document storage.

---

# 21. Final Decision Rules

Before modifying Prisma:

1. Existing models must be audited.
2. Existing relationships must be audited.
3. Existing services must be searched.
4. Existing controllers must be searched.
5. Existing API consumers must be searched.
6. Existing database migrations must be reviewed.
7. Existing production data must be considered.
8. Only then may schema modifications be designed.

No existing model should be deleted solely because V2 introduces a
better architecture.

---

# 22. Migration Principle

The migration strategy must prioritize:

- Data preservation
- Backward compatibility
- Controlled migration
- Transaction safety
- Rollback capability
- Minimal downtime
- Existing API compatibility where required

The final Prisma migration plan must be approved before execution.

---

# 23. Current Status

Architecture:

COMPLETE THROUGH CHAPTER 14

Prisma Mapping:

IN PROGRESS

Database Modification:

NOT STARTED

Prisma Migration:

NOT STARTED

Inventory Engine V2 Implementation:

NOT STARTED

Next activity:

Complete existing Prisma model and service dependency audit.

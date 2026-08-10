# TEXZIUM ERP
# Inventory Engine V2 — Service Contract

## 1. Purpose

Inventory Engine V2 is the central inventory state-management engine
for OperationsOS.

Business modules must request inventory mutations through the
Inventory Engine.

Business modules must not directly modify inventory balances.

---

# 2. Core Operations

Inventory Engine V2 provides the following core operations:

1. RECEIVE
2. RESERVE
3. RELEASE
4. PICK
5. PACK
6. ISSUE
7. TRANSFER
8. ADJUST

---

# 3. RECEIVE

## Purpose

Increase physical inventory through an approved receiving event.

## Typical callers

- Goods Receipt
- Purchase Receipt
- Production Receipt
- Customer Return
- RMA Receipt

## Responsibilities

- Validate inventory item
- Validate warehouse
- Validate location
- Validate batch where applicable
- Validate serial where applicable
- Increase on-hand quantity
- Increase available quantity where applicable
- Create inventory movement
- Create inventory ledger entry
- Record source document
- Record audit information

## Must not

Directly manipulate inventory from the calling module.

---

# 4. RESERVE

## Purpose

Commit available inventory to an approved demand.

## Typical callers

- Sales Order
- Dispatch Order
- Production
- Project
- Service

## Responsibilities

- Validate available quantity
- Create reservation
- Increase reserved quantity
- Reduce available quantity
- Record reservation reference
- Record inventory movement/ledger event
- Maintain idempotency

## Formula

Available Quantity = On Hand Quantity - Reserved Quantity

---

# 5. RELEASE

## Purpose

Remove an existing reservation without issuing physical inventory.

## Responsibilities

- Validate reservation
- Validate releasable quantity
- Reduce reserved quantity
- Increase available quantity
- Update reservation status
- Record ledger/movement event
- Maintain audit trail

---

# 6. PICK

## Purpose

Record physical picking against a reservation.

## Responsibilities

- Validate reservation
- Validate available reserved quantity
- Validate warehouse/location
- Validate batch/serial where applicable
- Record picked quantity
- Maintain dispatch/picking workflow state
- Record inventory event where required

Pick must not duplicate physical stock reduction if the business
process defines ISSUE as the physical stock deduction event.

---

# 7. PACK

## Purpose

Record packing of picked inventory.

## Responsibilities

- Validate picked quantity
- Validate workflow state
- Record packed quantity
- Maintain traceability
- Update dispatch workflow state

Packing must not independently deduct physical stock.

---

# 8. ISSUE

## Purpose

Remove physical inventory from stock.

## Typical callers

- Dispatch
- Spare Consumption
- Production Consumption
- Project Consumption
- Service Consumption
- Other approved inventory-consuming workflows

## Responsibilities

- Validate inventory
- Validate quantity
- Validate reservation where required
- Validate batch/serial where applicable
- Reduce on-hand quantity
- Reduce reserved quantity when issue is from reservation
- Recalculate available quantity
- Create inventory movement
- Create inventory ledger entry
- Record source document
- Record cost information
- Record audit information

---

# 9. TRANSFER

## Purpose

Move inventory between warehouses or locations without changing
total enterprise quantity.

## Responsibilities

- Validate source
- Validate destination
- Validate quantity
- Validate batch/serial
- Reduce source balance
- Increase destination balance
- Create transfer movement
- Create ledger entries
- Maintain complete traceability

Transfer must be atomic.

---

# 10. ADJUST

## Purpose

Correct inventory quantity through an approved inventory adjustment.

## Typical callers

- Stock Count
- Reconciliation
- Approved Manual Adjustment

## Responsibilities

- Require authorization
- Validate adjustment reason
- Calculate variance
- Apply quantity change
- Create adjustment movement
- Create ledger entry
- Record audit trail

Direct quantity editing is prohibited.

---

# 11. Transaction Boundary

Every inventory mutation must execute inside a database transaction.

Required atomic behavior:

Inventory State
+
Inventory Movement
+
Inventory Ledger
+
Reservation State
+
Reference State
+
Audit Event

must succeed together or roll back together.

---

# 12. Idempotency

Every externally-triggered inventory mutation must support idempotency.

The same business operation must not create duplicate inventory
movements when retried.

Idempotency must be based on a unique operation/reference key.

---

# 13. Concurrency

Inventory Engine must protect against concurrent stock mutations.

Operations must prevent:

- Double reservation
- Double issue
- Negative stock where prohibited
- Duplicate transfer
- Duplicate receipt

Database transactions and appropriate locking/concurrency controls
must be used.

---

# 14. Ledger Rule

Inventory balances are the current state.

Inventory ledger is the historical explanation of how that state was
created.

Ledger records must be append-oriented.

Historical movement records must not be silently overwritten.

---

# 15. Costing

Inventory Engine must support inventory costing according to the
approved company valuation method.

Supported architecture must allow:

- FIFO
- LIFO where enabled
- Weighted Average
- Standard Cost where configured

Costing implementation must integrate with FinanceOS.

---

# 16. Warehouse and Location

Inventory operations must support:

Warehouse
Zone
Rack
Bin / Location

Inventory must not depend on free-text warehouse names as the primary
relationship.

---

# 17. Batch

Batch-aware inventory must support:

- Batch identity
- Batch number
- Manufacturing date
- Expiry date
- Quantity
- Traceability
- Issue tracking

---

# 18. Serial

Serialized inventory must support:

- Unique serial number
- Inventory identity
- Warehouse/location
- Batch where applicable
- Receipt
- Transfer
- Issue
- Return
- Warranty relationship
- Complete movement history

---

# 19. Business Module Rule

Business modules own their business documents.

Inventory Engine owns inventory state.

Example:

Goods Receipt:

GoodsReceiptService
        ↓
InventoryEngine.receive()

Dispatch:

DispatchService
        ↓
InventoryEngine.issue()

Spare Consumption:

SpareConsumptionService
        ↓
InventoryEngine.issue()

Sales Reservation:

Sales/Dispatch Service
        ↓
InventoryEngine.reserve()

---

# 20. Read Operations

Inventory Engine may provide read APIs for:

- Current balance
- Available quantity
- Reserved quantity
- Stock by warehouse
- Stock by location
- Stock by batch
- Stock by serial
- Movement history
- Ledger history
- Valuation

Reporting modules may consume these read services.

---

# 21. Error Handling

Inventory Engine must use structured domain errors.

Examples:

- InventoryItemNotFound
- WarehouseNotFound
- LocationNotFound
- InsufficientStock
- InsufficientAvailableStock
- ReservationNotFound
- InvalidReservationState
- InvalidMovement
- DuplicateOperation
- InvalidBatch
- InvalidSerial

---

# 22. Audit

Every mutation must be audit-ready.

Required information includes:

- User
- Timestamp
- Operation
- Source module
- Source document
- Source document line
- Before quantity
- Movement quantity
- After quantity
- Warehouse
- Location
- Batch
- Serial
- Reason where applicable

---

# 23. Implementation Rule

Do not implement individual services independently.

All Inventory Engine services must conform to this contract.

Implementation order:

1. Domain types
2. Prisma schema
3. Inventory balance model
4. Movement model
5. Ledger model
6. Reservation model
7. Receive
8. Reserve
9. Release
10. Transfer
11. Issue
12. Pick
13. Pack
14. Adjustment
15. Cross-module integration
16. Tests
17. Migration of old services

---

# 24. Current Status

Architecture: COMPLETE

Prisma Audit: COMPLETE

Existing Service Audit: COMPLETE

Service Contract: IN PROGRESS

Prisma V2 Implementation: NOT STARTED

Inventory Engine V2 Implementation: NOT STARTED

Legacy Service Migration: NOT STARTED

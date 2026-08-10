# TEXZIUM ERP
# Inventory Engine Architecture v2.0

Status: DRAFT
Version: 2.0
Module: OperationsOS

## 1. Inventory Engine Purpose

The Inventory Engine is the centralized inventory transaction,
reservation, stock balance, warehouse-location, traceability,
costing, and inventory ledger engine of TEXZIUM ERP.

No business module may directly modify inventory balances
outside the Inventory Engine.

Business modules must request inventory operations through
the Inventory Engine.

## 2. Core Principles

1. Inventory movement must be transactional.
2. Inventory balances must remain internally consistent.
3. Every material stock movement must create a ledger transaction.
4. Inventory operations must support auditability.
5. Reservation must be separate from physical stock movement.
6. Warehouse and location must be explicit inventory dimensions.
7. Batch and serial traceability must be supported.
8. Inventory operations must be reusable by all ERP modules.
9. Business modules must not duplicate inventory movement logic.
10. Existing TEXZIUM ERP entities should be preserved where practical.

# 3. Inventory Domain Model

## 3.1 Inventory Item

InventoryItem represents the existing TEXZIUM ERP item/product identity.

The existing InventoryItem entity will be preserved during Inventory
Engine v2 implementation to avoid unnecessary disruption to existing
RevenueOS and OperationsOS relationships.

InventoryItem currently contains:

- SKU
- Product Name
- Category
- HSN reference
- Stock quantities
- Warehouse information
- Condition
- Warranty configuration

Inventory Engine v2 will progressively separate item identity from
physical inventory balance without breaking existing business-module
references.

## 3.2 Inventory Balance

Inventory Balance represents the quantity of a specific inventory item
at a specific inventory location and inventory state.

The logical inventory balance dimensions are:

- Inventory Item
- Warehouse
- Location / Bin
- Batch / Lot (optional)
- Serial Number (optional)
- Inventory Status

The balance quantities will include:

- On Hand Quantity
- Reserved Quantity
- Available Quantity
- Blocked Quantity
- QC Hold Quantity

The Inventory Engine must maintain quantity consistency across these
values.

## 3.3 Warehouse

Warehouse represents a physical or logical inventory storage facility.

A Warehouse is an independent master entity and must not be represented
only as free-form text.

A Warehouse may contain multiple locations.

## 3.4 Warehouse Location

Warehouse Location represents a physical storage location inside a
warehouse.

The architecture must support hierarchical locations such as:

Warehouse
→ Zone
→ Rack
→ Shelf
→ Bin

The final physical hierarchy will be determined during the database
design phase.

## 3.5 Batch / Lot

Batch or Lot represents a traceability unit for inventory that is
managed by batch.

Batch information may include:

- Batch Number
- Manufacturing Date
- Expiry Date
- QC Status
- Supplier Reference
- Product Reference

Batch tracking must be optional because not every inventory item
requires batch management.

## 3.6 Serial Number

Serial Number represents an individually traceable inventory unit.

Serial tracking must support the lifecycle of a serialized item across
inventory, dispatch, installation, warranty, service, asset management,
and returns.

## 3.7 Inventory Reservation

Inventory Reservation represents a commitment of available inventory
to a business requirement without physically reducing on-hand stock.

Reservation must remain separate from physical stock movement.

## 3.8 Inventory Movement

Inventory Movement represents a physical or accounting-relevant change
to inventory.

Examples include:

- Purchase Receipt
- Sales Issue
- Transfer
- Production Issue
- Production Receipt
- Service Issue
- Service Return
- Stock Adjustment
- Opening Stock
- RMA Receipt
- Scrap

Every inventory movement must be transactional and auditable.

## 3.9 Inventory Ledger

Inventory Ledger represents the immutable historical record of inventory
movements.

Ledger records must not be edited or deleted as part of normal business
operations.

Corrections must be performed through compensating inventory movements.

# 4. Inventory Balance & Quantity Model

## 4.1 Purpose

Inventory Balance represents the current inventory position of an
Inventory Item at a specific inventory location and traceability
dimension.

Inventory Balance is the operational source used by the Inventory
Engine to determine current stock availability.

The balance must be uniquely identifiable by its inventory dimensions.

## 4.2 Inventory Balance Dimensions

The logical dimensions of an Inventory Balance are:

1. Inventory Item
2. Warehouse
3. Location / Bin
4. Inventory Status
5. Batch / Lot, when applicable
6. Serial Number, when applicable

Not every inventory item requires batch or serial tracking.

## 4.3 Quantity Definitions

### On Hand Quantity

On Hand Quantity represents the physical quantity currently held at
the inventory location.

It changes when physical inventory is received, issued, transferred,
adjusted, returned, scrapped, or otherwise physically moved.

### Reserved Quantity

Reserved Quantity represents inventory committed to a business
requirement but not yet physically issued.

Reservation does not reduce physical On Hand Quantity.

### Available Quantity

Available Quantity represents inventory that may be newly reserved or
otherwise allocated.

The logical relationship is:

Available Quantity = On Hand Quantity - Reserved Quantity

The Inventory Engine must prevent Available Quantity from becoming
negative.

### Blocked Quantity

Blocked Quantity represents inventory that physically exists but cannot
currently be allocated for normal business use.

Examples include:

- Damaged stock
- Restricted stock
- Compliance hold
- Management hold

### QC Hold Quantity

QC Hold Quantity represents inventory awaiting or restricted by quality
inspection.

QC Hold inventory must not be considered normally available until the
quality process releases it.

## 4.4 Quantity Integrity Rules

The Inventory Engine must enforce the following rules:

1. On Hand Quantity cannot become negative unless a future business rule
   explicitly permits controlled negative inventory.

2. Reserved Quantity cannot exceed reservable On Hand Quantity.

3. Available Quantity cannot become negative.

4. Blocked Quantity cannot be allocated as normal available inventory.

5. QC Hold Quantity cannot be allocated as normal available inventory.

6. Inventory movement must update the affected balance transactionally.

7. Every physical movement must create an Inventory Ledger transaction.

8. A failed inventory transaction must roll back all related balance
   changes.

## 4.5 Example

SKU:

ABC-001

Warehouse:

Delhi Warehouse

Bin:

A-01-02

Batch:

BATCH-2026-001

Current position:

On Hand: 100
Reserved: 20
Available: 80
Blocked: 0
QC Hold: 0

A reservation of 15 units results in:

On Hand: 100
Reserved: 35
Available: 65
Blocked: 0
QC Hold: 0

The physical quantity remains 100.

An issue of 15 units after reservation results in:

On Hand: 85
Reserved: 20
Available: 65
Blocked: 0
QC Hold: 0

The reservation is consumed as part of the issue.

## 4.6 Multi-Warehouse Example

The same Inventory Item may exist at multiple locations:

Delhi / Bin A-01-02:
On Hand = 100

Mumbai / Bin B-02-01:
On Hand = 250

Jaipur / Bin C-03-05:
On Hand = 75

These are separate inventory balances.

The Inventory Engine must never combine physical location balances
into a single location record.

## 4.7 Reservation and Physical Stock

Reservation is a logical commitment.

It does not physically move inventory.

Therefore:

Reserve:
- On Hand remains unchanged
- Reserved increases
- Available decreases

Issue:
- On Hand decreases
- Reserved decreases when consuming a reservation
- Available is recalculated

Release:
- On Hand remains unchanged
- Reserved decreases
- Available increases

## 4.8 Inventory Balance and Ledger

Inventory Balance represents the current state.

Inventory Ledger represents the historical sequence of movements.

The two serve different purposes:

Inventory Balance:
"How much stock do we have now?"

Inventory Ledger:
"How did we arrive at this balance?"

The Inventory Engine must maintain both consistently.

# 5. Warehouse & Location Architecture

## 5.1 Warehouse

Warehouse represents a physical or logical facility in which inventory
is stored, received, processed, transferred, or dispatched.

Each warehouse must have a unique identifier.

Warehouse information must be maintained through a dedicated master
entity rather than free-form warehouse text.

A warehouse may contain one or more inventory locations.

## 5.2 Warehouse Location

Warehouse Location represents a physical storage position within a
warehouse.

The location hierarchy must support:

Warehouse
→ Zone
→ Rack
→ Shelf
→ Bin

The hierarchy must be flexible.

A warehouse may use only the levels required by its physical layout.

Examples:

Small Warehouse:
Warehouse → Bin

Medium Warehouse:
Warehouse → Zone → Bin

Large Warehouse:
Warehouse → Zone → Rack → Shelf → Bin

## 5.3 Location Identity

Every inventory location must have a unique identifier within its
warehouse.

A location should support:

- Location Code
- Location Name
- Parent Location
- Location Type
- Warehouse
- Active / Inactive status
- Capacity information where required

## 5.4 Location Types

The Inventory Engine should support location types including:

- WAREHOUSE
- ZONE
- RACK
- SHELF
- BIN
- RECEIVING
- QC_HOLD
- STAGING
- DISPATCH
- RETURN
- SCRAP

Additional location types may be introduced without changing the core
inventory movement architecture.

## 5.5 Inventory Location Rules

Inventory must always know its physical location when location tracking
is enabled for the warehouse.

Inventory movements between locations must be represented as inventory
movements.

A transfer must never modify one location balance without creating the
corresponding movement into the destination location.

## 5.6 Receiving Location

Receiving locations represent temporary or designated locations where
goods are placed immediately after receipt.

Received inventory may remain in a receiving location until:

- Quality inspection is completed
- Putaway is completed
- Inventory is released for normal use

## 5.7 Quality Hold Location

QC Hold locations are used for inventory that cannot yet be released
for normal allocation.

Inventory in QC Hold must not be treated as normally available stock.

## 5.8 Staging Location

Staging locations are temporary operational locations used during
warehouse execution.

Examples:

- Picking staging
- Packing staging
- Dispatch staging
- Transfer staging

Staging stock must remain traceable to its originating inventory
balance and movement.

## 5.9 Return Location

Return locations are used for inventory received through customer
returns, RMA processes, or service returns.

Returned inventory must not automatically become available stock.

It may require inspection or approval before release.

## 5.10 Scrap Location

Scrap locations represent inventory that has been identified as
scrapped or permanently unusable.

Scrapped inventory must be removed from normal available stock through
a controlled inventory movement.

## 5.11 Existing TEXZIUM ERP Compatibility

The existing TEXZIUM ERP schema contains warehouse-related fields in
multiple entities, including:

- warehouse
- warehouseId
- warehouseName
- zoneName
- rackNumber
- binNumber
- binLocation

Inventory Engine v2 must provide a migration path from these existing
fields to standardized warehouse and location entities.

Existing business entities must not be broken during migration.

## 5.12 Warehouse Transfer

A warehouse transfer consists of two logically connected movements:

1. Source location movement
2. Destination location movement

The transfer must be atomic.

If the destination movement fails, the source movement must also be
rolled back.

## 5.13 Location Availability

The Inventory Engine must be able to determine stock availability by:

- Inventory Item
- Warehouse
- Location
- Batch / Lot
- Serial Number
- Inventory Status

This information will support reservation, picking, transfer,
reconciliation, and reporting.

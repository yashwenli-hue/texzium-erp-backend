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

# 6. Inventory Movement Engine

## 6.1 Purpose

The Inventory Movement Engine is the centralized component responsible
for all physical and inventory-accounting movements.

No business module may directly modify inventory balance quantities.

Business modules must request inventory movements through the Inventory
Engine.

## 6.2 Movement Lifecycle

Every inventory movement follows this logical lifecycle:

Business Event
→ Validate Request
→ Validate Inventory Balance
→ Create Movement
→ Update Inventory Balance
→ Create Inventory Ledger Entry
→ Complete Transaction

All balance updates and ledger creation must occur within the same
database transaction.

If any step fails, the complete transaction must be rolled back.

## 6.3 Movement Types

The initial standard movement types are:

- OPENING_STOCK
- RECEIVE
- ISSUE
- TRANSFER
- ADJUSTMENT
- RETURN
- SCRAP

Additional movement types may be introduced when required by Production,
Service, Project, RMA, or other ERP modules.

## 6.4 Opening Stock

Opening Stock represents inventory introduced into TEXZIUM ERP during
initial implementation or controlled opening-balance entry.

Opening Stock must:

- Create an inventory balance
- Create a ledger entry
- Record the source/reference
- Record the user responsible
- Be auditable

Opening Stock must not be silently inserted directly into inventory
balance quantities.

## 6.5 Receive

Receive increases physical inventory.

Examples:

- Purchase Receipt
- Customer Return
- RMA Return
- Production Receipt
- Service Return

Receive operation:

On Hand:
+ Quantity

Reserved:
No automatic increase

Available:
Recalculated according to inventory status

A received quantity may initially enter a Receiving or QC Hold location
and become normally available only after the required workflow is
completed.

## 6.6 Issue

Issue decreases physical inventory.

Examples:

- Sales Dispatch
- Production Material Issue
- Service Spare Issue
- Project Material Issue
- Internal Consumption

Issue validation must verify:

1. Inventory Item exists.
2. Source warehouse/location exists.
3. Required quantity is available.
4. Inventory status permits issue.
5. Batch/serial requirements are satisfied.
6. Reservation requirements are satisfied when issuing reserved stock.

Issue operation:

On Hand:
- Quantity

Reserved:
- Consumed reservation quantity where applicable

Available:
Recalculated after movement.

## 6.7 Transfer

Transfer moves inventory from one location to another.

A transfer contains:

- Source Warehouse
- Source Location
- Destination Warehouse
- Destination Location
- Inventory Item
- Quantity
- Batch/Lot where applicable
- Serial Number where applicable
- Reference
- User

Transfer must be atomic.

The source reduction and destination increase must occur in the same
database transaction.

A successful transfer must produce corresponding ledger records for
the movement.

## 6.8 Adjustment

Adjustment represents a controlled correction to inventory quantity.

Examples:

- Physical count difference
- Data correction
- Damage correction
- Administrative adjustment

Adjustments must require:

- Adjustment reason
- User
- Reference
- Quantity
- Source/destination state where applicable

Adjustments must be fully auditable.

Negative adjustments must never allow unauthorized negative inventory.

## 6.9 Return

Return represents inventory coming back into controlled inventory from
another business process.

Examples:

- Customer Return
- RMA Return
- Service Return
- Vendor Return Reversal

Returned inventory must not automatically become normal available stock.

Depending on the business process, returned stock may enter:

- RETURN location
- QC Hold
- Inspection
- Available Stock
- Scrap

## 6.10 Scrap

Scrap represents inventory permanently removed from normal usable stock.

Scrap must require:

- Quantity
- Inventory Item
- Source Location
- Scrap reason
- User
- Reference
- Approval where required by company policy

Scrap must create a ledger movement.

## 6.11 Movement Direction

Each movement must have an explicit direction.

Inbound movements increase inventory.

Outbound movements decrease inventory.

Transfer movements contain both outbound and inbound effects.

The system must never infer movement direction from arbitrary strings.

## 6.12 Movement Quantity

Movement quantity must:

- Be greater than zero
- Use the inventory item's defined unit of measure
- Respect decimal precision appropriate for the item
- Never be silently rounded
- Be validated before the transaction begins

## 6.13 Movement Reference

Every movement must identify its business source.

Examples:

Purchase Receipt:
referenceModule = PROCUREMENT

Sales Dispatch:
referenceModule = DISPATCH

Production Issue:
referenceModule = PRODUCTION

Service Issue:
referenceModule = SERVICE

Project Issue:
referenceModule = PROJECT

RMA Return:
referenceModule = RMA

The final reference-module enumeration will be standardized during API
and database design.

## 6.14 Ledger Rule

Every completed inventory movement must produce an immutable ledger
record.

The ledger must contain enough information to reconstruct:

- What item moved
- Where it moved from
- Where it moved to
- How much moved
- Why it moved
- Which business document caused it
- Which user performed it
- When it happened

## 6.15 Balance and Ledger Consistency

Inventory Balance represents the current operational state.

Inventory Ledger represents the historical movement history.

Both must be updated within the same database transaction.

A successful balance update without a ledger entry is invalid.

A successful ledger entry without the corresponding balance update is
also invalid.

## 6.16 Concurrency Control

Inventory movements must protect against concurrent stock changes.

The implementation must prevent two simultaneous transactions from
issuing the same available inventory quantity.

The final implementation strategy may use database transactions,
conditional updates, row-level locking, or another PostgreSQL-safe
concurrency mechanism.

## 6.17 Idempotency

Inventory movements originating from external systems or retried API
requests must support idempotency.

A repeated request with the same idempotency/reference key must not
create duplicate physical inventory movements.

## 6.18 Auditability

Every movement must be traceable to:

- User
- Timestamp
- Business Module
- Business Reference
- Movement Type
- Source Location
- Destination Location
- Quantity
- Reason where applicable

Inventory history must remain auditable after the original business
document is completed.

# 7. Inventory Reservation Engine

## 7.1 Purpose

The Reservation Engine manages logical commitments of available
inventory to business requirements.

Reservation does not physically move inventory.

Reservation reduces the quantity available for new allocation while
leaving physical On Hand Quantity unchanged.

## 7.2 Reservation Lifecycle

The standard reservation lifecycle is:

AVAILABLE
    ↓
RESERVED
    ↓
CONSUMED

A reservation may alternatively be:

AVAILABLE
    ↓
RESERVED
    ↓
RELEASED

or:

AVAILABLE
    ↓
RESERVED
    ↓
EXPIRED

depending on the business process.

## 7.3 Reserve

Reserve creates a logical commitment against available inventory.

Reserve validation must verify:

1. Inventory Item exists.
2. Warehouse exists when warehouse tracking is enabled.
3. Location exists when location tracking is enabled.
4. Required quantity is greater than zero.
5. Available Quantity is sufficient.
6. Batch requirements are satisfied when applicable.
7. Serial requirements are satisfied when applicable.
8. The requesting business document is valid.

Reserve operation:

On Hand:
No change

Reserved:
+ Quantity

Available:
- Quantity

A reservation record must be created.

## 7.4 Reservation Record

Each reservation must identify:

- Inventory Item
- Warehouse
- Location
- Batch / Lot where applicable
- Serial Number where applicable
- Quantity
- Reservation Status
- Reservation Type
- Source Module
- Source Document
- Source Document Line where applicable
- Reserved By
- Reserved At
- Expiry Date where applicable
- Priority
- Remarks

The existing InventoryReservation entity must be evaluated and
extended during database implementation rather than creating duplicate
reservation concepts.

## 7.5 Reservation Statuses

The initial reservation statuses are:

- RESERVED
- PARTIALLY_CONSUMED
- CONSUMED
- RELEASED
- EXPIRED
- CANCELLED

Status transitions must be controlled by the Inventory Engine.

## 7.6 Partial Reservation

A business requirement may request more inventory than is currently
available.

The Inventory Engine must support controlled partial reservation when
the calling workflow allows it.

Example:

Requested:
100

Available:
60

Possible result:

Reserved:
60

Unfulfilled:
40

Whether partial reservation is permitted must be determined by the
calling business workflow.

## 7.7 Multiple Reservations

Multiple business requirements may reserve the same Inventory Item.

The Inventory Engine must ensure that the total active reservation
quantity does not exceed reservable inventory.

Example:

On Hand:
100

Reservation A:
30

Reservation B:
20

Reservation C:
40

Total Reserved:
90

Available:
10

A new reservation of 20 must fail unless inventory becomes available.

## 7.8 Reservation Priority

Reservations may have priority levels.

Initial priority levels:

- LOW
- NORMAL
- HIGH
- CRITICAL

Priority may be used during allocation and shortage management.

Priority must not allow the system to exceed physical available
inventory.

## 7.9 Reservation Release

Release removes a logical commitment without physically moving stock.

Release operation:

On Hand:
No change

Reserved:
- Quantity

Available:
+ Quantity

The reservation record must transition to an appropriate status.

A release must be idempotent.

The same reservation quantity must not be released twice.

## 7.10 Reservation Consumption

When reserved inventory is physically issued, the reservation is
consumed.

Consumption must occur as part of the same database transaction as the
physical issue.

Example:

Before issue:

On Hand:
100

Reserved:
30

Available:
70

Issue:
30

After issue:

On Hand:
70

Reserved:
0

Available:
70

The reservation must transition to CONSUMED.

## 7.11 Partial Consumption

A reservation may be consumed partially.

Example:

Reservation:
50

Issue:
20

Remaining Reservation:
30

The reservation status becomes:

PARTIALLY_CONSUMED

The remaining 30 remains reserved.

## 7.12 Reservation Cancellation

Cancellation releases any remaining reserved quantity.

Cancellation must not alter historical consumed quantities.

Example:

Original Reservation:
50

Consumed:
20

Remaining:
30

Cancellation releases only:

30

The historical 20 remains consumed.

## 7.13 Reservation Expiry

Reservations may have an expiry date.

Expired reservations must not continue blocking inventory.

Expiry processing must:

1. Identify expired active reservations.
2. Release their remaining quantities.
3. Update reservation status.
4. Restore Available Quantity.
5. Create an audit record.

Automatic expiry processing may be implemented through a scheduled
background job.

## 7.14 Reservation Source

Reservations must identify the business process that created them.

Examples:

Sales Order:
REVENUE

Production Requirement:
PRODUCTION

Service Requirement:
SERVICE

Project Requirement:
PROJECT

Internal Requirement:
INTERNAL

The final source-module enumeration will be standardized during API
and database design.

## 7.15 Reservation and Dispatch

DispatchOS may request inventory reservation for a Dispatch Order Item.

The logical flow is:

Sales Order
    ↓
Dispatch Order
    ↓
Dispatch Order Item
    ↓
Inventory Reservation
    ↓
Pick
    ↓
Pack
    ↓
Issue
    ↓
Dispatch

DispatchOS owns the dispatch workflow.

Inventory Engine owns the inventory reservation and physical stock
operations.

## 7.16 Reservation and Pick

Picking does not automatically mean physical inventory has been issued.

Pick represents warehouse execution of a reservation.

The Inventory Engine must distinguish:

Reserved:
Logical commitment

Picked:
Physical warehouse execution state

Issued:
Physical inventory removal

These states must not be conflated.

## 7.17 Reservation and Pack

Packing is a warehouse execution state.

Packing does not itself necessarily remove inventory from On Hand.

The physical inventory issue occurs according to the configured business
workflow, normally at the Issue / Dispatch stage.

## 7.18 Reservation Validation

Before creating a reservation, the Inventory Engine must validate the
current inventory balance inside a database transaction.

The validation and reservation update must be protected against
concurrent reservation requests.

Two simultaneous requests must not reserve the same available quantity.

## 7.19 Reservation Idempotency

Repeated reservation requests must not create duplicate reservations.

Where the business document provides a unique reservation reference,
the Inventory Engine must use that reference to guarantee idempotency.

## 7.20 Reservation Audit

Every reservation action must be auditable.

The audit trail must identify:

- User
- Timestamp
- Inventory Item
- Warehouse
- Location
- Quantity
- Source Module
- Source Document
- Action
- Previous Status
- New Status
- Remarks

Actions include:

- CREATED
- PARTIALLY_CONSUMED
- CONSUMED
- RELEASED
- EXPIRED
- CANCELLED

# 8. Pick, Pack & Dispatch Integration

## 8.1 Purpose

Pick, Pack, and Dispatch are warehouse execution processes that consume
or execute inventory reservations.

The Inventory Engine must remain responsible for inventory quantities,
reservations, and physical inventory movements.

DispatchOS remains responsible for the Dispatch Order workflow.

## 8.2 Dispatch Workflow

The standard dispatch workflow is:

Sales Order
    ↓
Dispatch Order
    ↓
Dispatch Order Item
    ↓
Reservation
    ↓
Pick
    ↓
Pack
    ↓
Issue
    ↓
Dispatch
    ↓
Ready for Invoicing

The exact workflow may be configured through the ERP approval and
workflow engines.

## 8.3 Reserve

Reserve creates the inventory commitment.

Reserve:

- Does not reduce On Hand
- Increases Reserved
- Decreases Available
- Creates or updates Inventory Reservation
- Updates Dispatch Order Item reservation state where applicable

DispatchOS must not directly manipulate inventory balance quantities.

## 8.4 Pick

Pick represents the physical warehouse execution of a reservation.

Pick validation must verify:

1. Dispatch Order Item exists.
2. Reservation exists when reservation is required.
3. Requested quantity is positive.
4. Requested quantity does not exceed the remaining reservable/pickable
   quantity.
5. Required warehouse and location information exists.
6. Batch/serial requirements are satisfied where applicable.

Pick normally changes warehouse execution state rather than reducing
the final On Hand inventory quantity.

The exact physical-location movement associated with picking will be
defined by the warehouse configuration.

## 8.5 Pick Quantity

A Dispatch Order Item must support:

- Ordered Quantity
- Reserved Quantity
- Picked Quantity
- Packed Quantity
- Dispatched Quantity

The Inventory Engine must prevent:

Picked Quantity > Reserved Quantity

when reservation is mandatory.

Partial picking must be supported.

Example:

Ordered:
100

Reserved:
100

Picked:
60

Remaining to Pick:
40

## 8.6 Pack

Pack represents the physical packing of picked inventory.

Pack validation must verify:

1. Dispatch Order Item exists.
2. Required quantity has been picked.
3. Packed quantity does not exceed picked quantity.
4. Batch/serial traceability remains intact.
5. Packing state is valid.

Packing normally does not reduce final On Hand inventory.

## 8.7 Packed Quantity

A Dispatch Order Item must maintain:

Ordered Quantity
Reserved Quantity
Picked Quantity
Packed Quantity
Dispatched Quantity

The following relationship must normally hold:

Dispatched Quantity <= Packed Quantity
Packed Quantity <= Picked Quantity
Picked Quantity <= Reserved Quantity

The workflow may permit controlled exceptions only when explicitly
configured.

## 8.8 Issue

Issue represents the physical inventory movement out of available
inventory.

At Issue:

On Hand decreases.

Reserved quantity is consumed where the issue consumes a reservation.

Available quantity is recalculated.

An Inventory Ledger transaction is created.

Issue must occur inside the same database transaction as the affected
inventory balance changes.

## 8.9 Dispatch

Dispatch represents the completion of the shipment workflow.

Dispatch validation must verify:

1. Dispatch Order exists.
2. Dispatch Order is in a valid pre-dispatch status.
3. Required items are packed.
4. Required inventory issue has completed.
5. Required quantities are dispatched.
6. Required serial/batch traceability is complete.
7. Required logistics information is present.

Dispatch completion updates the Dispatch Order status.

## 8.10 Dispatch and Inventory Separation

DispatchOS owns:

- Dispatch Order
- Dispatch Order Items
- Packing workflow
- Logistics workflow
- Gate Out
- Dispatch status
- Shipment information

Inventory Engine owns:

- Inventory Balance
- Reservation
- Inventory Movement
- Inventory Ledger
- Warehouse Location
- Batch
- Serial

Neither module should duplicate the other's core responsibilities.

## 8.11 Existing DispatchOrderItem Compatibility

The existing DispatchOrderItem contains:

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
- isReserved
- isPicked
- isPacked
- isDispatched

These fields should be retained during the migration unless a later
architecture decision establishes a stronger normalized representation.

DispatchOrderItem remains the workflow-level record.

Inventory Balance and Inventory Reservation remain the inventory-level
records.

## 8.12 Dispatch Reservation Mapping

The relationship should logically be:

DispatchOrderItem
        │
        └── Inventory Reservation

The reservation must identify the inventory requirement associated with
the Dispatch Order Item.

A Dispatch Order Item may require multiple reservation records when:

- Multiple batches are used
- Multiple warehouses are used
- Multiple bins are used
- Multiple serial numbers are used

## 8.13 Batch Allocation During Picking

When batch-controlled inventory is used, picking must identify the
actual batch allocated to the Dispatch Order Item.

Example:

Requested:
100

Batch A:
60

Batch B:
40

The dispatch line may therefore be fulfilled through:

Batch A → 60
Batch B → 40

The Inventory Engine must preserve this traceability through Issue.

## 8.14 Serial Allocation During Picking

For serialized inventory, every physical unit must be individually
identified.

Example:

Requested:
3

Serials:

SN001
SN002
SN003

The Inventory Engine must prevent:

- Duplicate serial allocation
- Issuing an unavailable serial
- Issuing the same serial twice
- Issuing a serial belonging to another inventory location

## 8.15 Partial Dispatch

The system must support partial dispatch when permitted by the
Dispatch Order workflow.

Example:

Ordered:
100

Reserved:
100

Picked:
60

Packed:
60

Dispatched:
60

Remaining:
40

The Dispatch Order must remain in an appropriate partial status until
the remaining quantity is completed or explicitly cancelled.

## 8.16 Dispatch Failure

If inventory Issue fails:

- Inventory quantities must not change.
- Reservation must not be incorrectly consumed.
- Ledger entries must not be created.
- Dispatch must not be marked completed.

The complete Issue transaction must roll back.

## 8.17 Dispatch Idempotency

Repeated dispatch requests must not issue the same inventory twice.

The Inventory Engine must detect whether the required inventory issue
has already been completed for the business reference.

## 8.18 Sales Order Integration

After successful dispatch completion, DispatchOS may update the Sales
Order according to the configured sales workflow.

For the existing implementation, the intended transition is:

DISPATCHED
    ↓
Sales Order READY_FOR_INVOICING

The final Sales Order workflow will be governed by RevenueOS.

## 8.19 Invoice Independence

Inventory dispatch and invoicing must remain separate business events.

A successful inventory issue must not automatically create an invoice
unless RevenueOS explicitly requests that behavior.

Similarly, invoice creation must not silently alter physical inventory.

## 8.20 Audit Trail

Pick, Pack, Issue, and Dispatch actions must be auditable.

The audit information should include:

- User
- Timestamp
- Dispatch Order
- Dispatch Order Item
- Inventory Item
- Warehouse
- Location
- Quantity
- Batch
- Serial
- Action
- Reference
- Remarks

## 8.21 Module Boundary

The final integration boundary is:

DispatchOS
    ↓
Inventory Engine API

DispatchOS requests:

- Reserve
- Pick
- Pack
- Issue

Inventory Engine performs inventory-specific validation and state
changes.

DispatchOS must not directly update InventoryItem stock quantities.

# 9. Batch & Lot Traceability

## 9.1 Purpose

Batch and Lot management provides traceability for inventory that must
be identified and controlled by a batch or lot number.

Batch-controlled inventory must remain traceable from receipt through
storage, reservation, picking, issue, dispatch, return, adjustment,
and final disposition.

## 9.2 Batch Applicability

Batch tracking is optional at the Inventory Item level.

Each Inventory Item must have a defined tracking policy indicating
whether it is:

- NON_TRACKED
- BATCH_TRACKED
- SERIAL_TRACKED

A future configuration may support combined batch and serial tracking
where required.

## 9.3 Batch Identity

A Batch must have a unique identity within the applicable inventory
context.

The Batch concept should support:

- Batch ID
- Batch Number
- Inventory Item
- Manufacturing Date
- Expiry Date
- Supplier Reference
- Purchase Reference
- Quality Status
- Batch Status
- Remarks
- Created At
- Updated At

The exact database uniqueness rule will be finalized during Prisma
schema design.

## 9.4 Batch Status

Initial batch statuses are:

- ACTIVE
- QC_HOLD
- APPROVED
- BLOCKED
- EXPIRED
- EXHAUSTED
- QUARANTINED
- SCRAPPED

Status transitions must be controlled.

An EXPIRED, BLOCKED, QUARANTINED, or SCRAPPED batch must not be
allocated as normal available inventory.

## 9.5 Batch Quantity

Batch quantity must be represented through Inventory Balance rather than
maintaining an independent conflicting quantity counter.

Example:

Inventory Item:
ABC-001

Warehouse:
Delhi

Bin:
A-01

Batch:
BATCH-001

Inventory Balance:

On Hand:
100

Reserved:
20

Available:
80

The Batch identifies the traceability dimension while Inventory Balance
maintains the operational quantity.

## 9.6 Batch Receipt

When batch-controlled inventory is received:

1. Validate the Inventory Item.
2. Validate or create the Batch according to business policy.
3. Record the received quantity.
4. Assign the batch to the receiving location.
5. Create the inventory movement.
6. Create the ledger entry.
7. Apply QC status where required.

The batch must be traceable to the originating receipt.

## 9.7 Batch and Quality Control

A received batch may initially be placed under QC Hold.

Example:

Received:
100

QC Hold:
100

Available:
0

After QC approval:

QC Hold:
0

Available:
100

The release from QC must be an auditable inventory state transition.

## 9.8 Batch Allocation

When inventory is reserved, the Inventory Engine may allocate specific
batches according to the applicable allocation policy.

Allocation policies may include:

- FIFO
- FEFO
- Manual Selection
- Specific Batch Selection

The allocation policy must be configurable according to the Inventory
Item and business workflow.

## 9.9 FIFO

FIFO means First In, First Out.

The Inventory Engine selects the oldest eligible batch based on the
configured FIFO date.

FIFO must only consider batches that are:

- Active
- Available
- Not blocked
- Not expired
- Eligible for the requesting transaction

## 9.10 FEFO

FEFO means First Expiry, First Out.

For expiry-controlled inventory, FEFO should normally prioritize the
batch with the earliest valid expiry date.

Expired batches must not be automatically allocated.

## 9.11 Manual Batch Selection

Authorized users may manually select a batch.

Manual selection must still validate:

- Available quantity
- Batch status
- Expiry
- Warehouse
- Location
- Reservation quantity
- Required QC status

Manual selection must be auditable.

## 9.12 Multi-Batch Fulfillment

One business requirement may be fulfilled using multiple batches.

Example:

Requested:
100

Batch A:
60

Batch B:
40

The resulting allocation is:

Batch A → 60
Batch B → 40

Each batch allocation must remain independently traceable.

## 9.13 Batch Reservation

When a batch is specifically allocated to a reservation, the
reservation must identify the batch.

If the reservation is not batch-specific, the Inventory Engine may
select the appropriate batch during allocation according to the
configured allocation policy.

## 9.14 Batch Picking

Picking batch-controlled inventory must identify the actual batch
physically picked.

The picked batch must match the reservation/allocation unless an
authorized substitution workflow is used.

## 9.15 Batch Packing

Packing must preserve batch traceability.

The packed quantity must remain associated with its batch allocation.

## 9.16 Batch Issue

When batch-controlled inventory is issued:

1. Validate batch status.
2. Validate available quantity.
3. Validate warehouse and location.
4. Validate reservation where required.
5. Reduce the appropriate Inventory Balance.
6. Create the Inventory Ledger entry.
7. Record the batch in the business transaction.

Batch issue must be atomic.

## 9.17 Batch Transfer

A batch transfer moves a specific quantity of a batch from one inventory
location to another.

Example:

Delhi / A-01 / Batch A:
100

Transfer:
30

Result:

Delhi / A-01 / Batch A:
70

Mumbai / B-04 / Batch A:
30

Both movements must occur within one database transaction.

## 9.18 Batch Return

Returned batch inventory must retain its original batch identity when
the batch can be reliably identified.

If batch identity cannot be verified, the return must enter a controlled
inspection or quarantine workflow.

Returned inventory must not automatically become available.

## 9.19 Batch Expiry

Expiry-controlled batches must support automated expiry monitoring.

Expired batches must:

- Become ineligible for normal allocation
- Remain physically traceable
- Remain visible in inventory reporting
- Be available for controlled disposition

Expiry must not silently delete or remove the batch.

## 9.20 Batch Traceability

The system must support forward and backward traceability.

Backward traceability:

Batch
→ Receipt
→ Supplier
→ Purchase Document

Forward traceability:

Batch
→ Reservation
→ Pick
→ Issue
→ Dispatch
→ Customer / Business Document

The exact downstream relationships will be implemented through
inventory movement references.

## 9.21 Batch and Serial Relationship

A product may be configured as:

- Batch controlled
- Serial controlled
- Non-tracked

Where combined batch and serial tracking is required, each serial must
belong to the applicable batch.

The final combined tracking model will be defined during Serial Number
Architecture.

## 9.22 Batch Audit

Batch-related actions must be auditable.

Audit information should include:

- Batch
- Inventory Item
- Warehouse
- Location
- Quantity
- Action
- User
- Timestamp
- Source Module
- Source Document
- Previous Status
- New Status
- Remarks

# 10. Serial Number Architecture

## 10.1 Purpose

Serial Number management provides individual-unit traceability for
serialized inventory.

Each serialized physical unit must be individually identifiable and
traceable throughout its inventory and business lifecycle.

## 10.2 Serial Tracking Policy

Inventory Items may be configured as:

- NON_TRACKED
- BATCH_TRACKED
- SERIAL_TRACKED

A future configuration may support combined batch and serial tracking.

Serial tracking requirements must be determined by the Inventory Item
master configuration.

## 10.3 Serial Identity

Each serialized unit must have a unique serial identity.

A Serial Number record should support:

- Serial ID
- Serial Number
- Inventory Item
- Batch / Lot where applicable
- Current Warehouse
- Current Location
- Current Status
- Receipt Reference
- Current Ownership Context
- Created At
- Updated At

The final uniqueness rules will be finalized during Prisma schema
design.

## 10.4 Serial Status

Initial serial statuses are:

- AVAILABLE
- RESERVED
- PICKED
- PACKED
- ISSUED
- INSTALLED
- IN_SERVICE
- RETURNED
- QC_HOLD
- BLOCKED
- SCRAPPED

Status transitions must be controlled by the Inventory Engine and
related business workflows.

## 10.5 Serial Quantity Rule

For serialized inventory:

One Serial Number represents one physical unit.

Therefore:

Serial Quantity = 1

The Inventory Engine must never allow a single serial number to
represent a quantity greater than one.

## 10.6 Serial Receipt

When serialized inventory is received:

1. Validate the Inventory Item.
2. Validate the serial number.
3. Ensure the serial number is not already active for another unit.
4. Create or register the serial.
5. Assign warehouse and location.
6. Apply QC status where required.
7. Create the inventory movement.
8. Create the ledger entry.

The receipt must remain traceable to the originating document.

## 10.7 Serial Reservation

Serialized inventory may be reserved in two ways:

### Generic Reservation

The business requirement reserves a quantity of serialized inventory
without selecting specific serial numbers.

The Inventory Engine selects eligible serials during allocation or
picking.

### Specific Serial Reservation

The business requirement explicitly selects one or more serial numbers.

The selected serials must be validated for:

- Availability
- Warehouse
- Location
- Status
- Item
- Batch where applicable

## 10.8 Serial Allocation

Serial allocation must never allocate:

- A blocked serial
- A scrapped serial
- An issued serial
- An installed serial
- A serial already reserved by another active requirement

The allocation must be atomic.

## 10.9 Serial Picking

Picking serialized inventory must identify the actual serial numbers
physically picked.

Example:

Requested:

3 units

Selected:

SN001
SN002
SN003

The system must preserve this relationship with the Dispatch Order Item
and inventory reservation.

## 10.10 Serial Packing

Packing must preserve serial traceability.

Each packed serialized unit must remain associated with its serial
number.

The system must prevent the same serial from being packed twice for
different shipments.

## 10.11 Serial Issue

Issue represents physical removal of serialized inventory from normal
inventory.

For each serial issued:

- Serial status changes appropriately
- Current inventory location is updated
- Inventory balance is updated
- Inventory ledger entry is created
- Business reference is recorded

The entire operation must be transactional.

## 10.12 Serial Dispatch

Dispatch completion must retain serial traceability.

The system must be able to answer:

Which serial numbers were dispatched on this Dispatch Order?

The relationship should be:

Dispatch Order
    ↓
Dispatch Order Item
    ↓
Serial Allocation
    ↓
Serial Number

## 10.13 Serial Installation

If a serialized product is installed at a customer or project location,
the serial lifecycle may continue:

ISSUED
   ↓
INSTALLED
   ↓
IN_SERVICE

Installation must not erase historical inventory information.

The system must retain:

- Original receipt
- Previous warehouse
- Issue document
- Dispatch document
- Customer/project
- Installation record

## 10.14 Serial and Asset Management

A serialized inventory item may become an Asset after installation or
capitalization according to FinanceOS / AssetOS rules.

The Inventory Engine must not duplicate Asset ownership logic.

Instead, it must provide the serial identity and movement history that
AssetOS requires.

## 10.15 Serial Warranty

WarrantyOS may reference the serial number to determine:

- Warranty start
- Warranty end
- Product identity
- Customer
- Installation
- Service history

Inventory Engine remains responsible for serial identity and movement
history.

Warranty business rules remain outside the Inventory Engine.

## 10.16 Serial Service

ServiceOS may reference a serialized product during:

- Service Ticket
- Engineer Visit
- Spare Consumption
- Repair
- Replacement

Inventory Engine remains responsible for the serial's inventory
movement.

ServiceOS remains responsible for service workflow.

## 10.17 Serial Return

When a serialized product is returned:

1. Identify the serial.
2. Validate the return reference.
3. Change serial status to RETURNED or QC_HOLD.
4. Assign the appropriate return location.
5. Create the inventory movement.
6. Create the ledger entry.
7. Preserve the original serial history.

Returned serialized inventory must not automatically become available.

## 10.18 Serial Transfer

A serial may move between:

- Warehouses
- Locations
- Staging areas
- Service locations
- Customer/project locations

Every movement must be recorded.

Example:

Delhi / A-01
    ↓
TRANSFER
    ↓
Mumbai / B-04

The serial's current location becomes Mumbai / B-04.

Historical movements remain immutable.

## 10.19 Serial Replacement

When a serialized product is replaced:

Old Serial:
SN001

Replacement:
SN002

The system must retain both histories and record the replacement
relationship.

The old serial must not be overwritten.

## 10.20 Serial Duplicate Prevention

The Inventory Engine must enforce duplicate serial protection.

A serial number that is already registered as an active serialized
unit must not be registered again for the same inventory context.

Any business-specific exception must be explicitly authorized and
audited.

## 10.21 Serial Traceability

The system must support complete forward and backward traceability.

Backward:

Serial
→ Receipt
→ Supplier
→ Purchase Document

Forward:

Serial
→ Reservation
→ Pick
→ Pack
→ Issue
→ Dispatch
→ Customer / Project
→ Installation
→ Warranty
→ Service
→ Return

## 10.22 Serial Audit

Serial-related actions must be auditable.

Audit information should include:

- Serial Number
- Inventory Item
- Batch where applicable
- Warehouse
- Location
- Previous Status
- New Status
- Quantity
- Action
- User
- Timestamp
- Source Module
- Source Document
- Remarks

# 11. Inventory Ledger & Costing Architecture

## 11.1 Purpose

The Inventory Ledger is the immutable historical record of inventory
movements.

The ledger records every inventory movement that changes inventory
quantity or inventory valuation.

Inventory Balance represents the current state.

Inventory Ledger represents the historical sequence of events.

Inventory Costing determines the monetary value associated with those
inventory movements.

## 11.2 Ledger Principles

The Inventory Ledger must be:

- Append-only
- Immutable
- Transactional
- Auditable
- Traceable to the originating business document

Normal business operations must never edit or delete completed ledger
records.

Corrections must be performed through controlled compensating
transactions.

## 11.3 Ledger Entry

A ledger entry should identify:

- Ledger ID
- Inventory Item
- Warehouse
- Location
- Batch / Lot where applicable
- Serial Number where applicable
- Movement Type
- Movement Direction
- Quantity
- Unit Cost
- Total Cost
- Balance Quantity After Movement
- Balance Value After Movement
- Source Module
- Source Document
- Source Document Line
- Reference ID
- User
- Timestamp
- Remarks

The final database representation will be defined during Prisma schema
design.

## 11.4 Ledger Direction

Inventory movement direction must be explicit.

Inbound:

Quantity increases inventory.

Outbound:

Quantity decreases inventory.

Transfer:

Source inventory decreases and destination inventory increases.

Adjustment:

Quantity may increase or decrease depending on the approved adjustment.

## 11.5 Ledger Quantity

Ledger quantity must represent the quantity affected by the movement.

Examples:

Purchase Receipt:

+100

Sales Issue:

-20

Transfer Out:

-30

Transfer In:

+30

Stock Adjustment Increase:

+5

Stock Adjustment Decrease:

-5

The sign convention must be standardized during API implementation.

## 11.6 Running Balance

Every ledger movement should record the resulting balance where required
for operational reporting.

Example:

Opening Stock:
+100
Balance:
100

Receipt:
+50
Balance:
150

Issue:
-20
Balance:
130

Issue:
-30
Balance:
100

The running balance is informational and must remain consistent with the
Inventory Balance.

## 11.7 Ledger and Inventory Balance

Inventory Balance and Inventory Ledger must be updated in the same
database transaction.

Valid state:

Inventory Balance updated
+
Ledger entry created

Invalid state:

Inventory Balance updated
+
Ledger entry missing

Invalid state:

Ledger entry created
+
Inventory Balance not updated

## 11.8 Ledger Reference

Every ledger entry must be traceable to its business source.

Examples:

PROCUREMENT:
Purchase Receipt

REVENUE:
Sales Dispatch

SERVICE:
Spare Consumption

PROJECT:
Project Material Issue

PRODUCTION:
Material Issue / Production Receipt

RMA:
Customer Return

INVENTORY:
Stock Adjustment

The exact source-module enumeration will be finalized during API
design.

## 11.9 Inventory Cost

Inventory Cost represents the monetary value associated with inventory.

The system must distinguish:

- Quantity
- Unit Cost
- Total Cost
- Inventory Value

Quantity and monetary value must never be conflated.

## 11.10 Costing Methods

TEXZIUM ERP should support configurable inventory costing methods.

Initial supported methods:

- FIFO
- WEIGHTED_AVERAGE
- STANDARD_COST

The company or inventory item costing policy will determine which method
is applied.

## 11.11 FIFO Costing

FIFO means First In, First Out.

Inventory is valued and consumed based on the oldest eligible cost layer.

Example:

Receipt 1:
100 units @ ₹100

Receipt 2:
100 units @ ₹120

Issue:
50 units

FIFO consumption:

50 × ₹100

Remaining:

50 units @ ₹100
100 units @ ₹120

Cost layers must remain traceable to their originating receipt.

## 11.12 Weighted Average Costing

Weighted Average Cost recalculates the average inventory cost when
inventory is received.

Example:

Existing:

100 units @ ₹100
Value = ₹10,000

Receipt:

100 units @ ₹120
Value = ₹12,000

Combined:

200 units
Value = ₹22,000

Weighted Average Cost:

₹110 per unit

A subsequent issue uses the applicable weighted average cost.

## 11.13 Standard Costing

Standard Costing assigns a predefined standard cost to an inventory
item.

Example:

Standard Cost:
₹500

Receipt:
100 units

Inventory value:
100 × ₹500

Purchase price variances may be recorded separately according to the
FinanceOS accounting design.

## 11.14 Cost Layers

Cost layers represent inventory quantities associated with a particular
cost basis.

A cost layer may identify:

- Inventory Item
- Receipt Reference
- Batch
- Quantity Received
- Quantity Remaining
- Unit Cost
- Total Cost
- Date

FIFO costing depends on maintaining cost layers.

## 11.15 Issue Costing

When inventory is issued, the Inventory Engine must determine the cost
according to the configured costing method.

The issue must record:

- Quantity
- Unit Cost
- Total Cost
- Costing Method
- Consumed Cost Layer where applicable

This information is required by FinanceOS for inventory accounting.

## 11.16 Transfer Costing

A warehouse transfer does not create an economic gain or loss merely
because inventory moved between locations.

The destination inventory should inherit the appropriate cost basis
from the source inventory.

Transfer costing must preserve:

- Original cost
- Cost layer
- Batch
- Serial where applicable

The exact accounting treatment will be finalized with FinanceOS.

## 11.17 Return Costing

Returns must preserve traceability to the original inventory movement
where possible.

A customer return may require:

- Original issue cost
- Current valuation
- Inspection result
- Restocking decision

Returned inventory must not automatically receive an arbitrary cost.

## 11.18 Scrap Costing

Scrapping inventory removes its usable quantity and associated
inventory value.

The Inventory Engine must record:

- Quantity scrapped
- Cost
- Total inventory value removed
- Scrap reason
- Source location
- Reference
- User

FinanceOS may subsequently post the accounting impact.

## 11.19 Adjustment Costing

Inventory adjustments must determine the monetary effect of the
quantity difference.

Positive adjustment:

Inventory quantity increases
+
Inventory value increases according to the applicable valuation rule.

Negative adjustment:

Inventory quantity decreases
+
Inventory value decreases according to the applicable valuation rule.

The accounting treatment must remain traceable to the adjustment
document.

## 11.20 Inventory Valuation

The system must be able to calculate inventory valuation by:

- Inventory Item
- Warehouse
- Location
- Batch
- Serial
- Cost Layer
- Company
- Financial Period

Inventory valuation must support FinanceOS reporting.

## 11.21 Period Closing

Inventory movements may be subject to financial period controls.

After an inventory/accounting period is closed:

- Historical ledger entries must remain immutable.
- Backdated movements must be restricted.
- Corrections must follow controlled adjustment/reopening procedures.
- Inventory valuation must remain reproducible.

## 11.22 Ledger Reversal

Completed ledger entries must not be edited to correct mistakes.

Instead, the system must create a reversal or compensating movement.

Example:

Original:

ISSUE
-20

Correction:

ISSUE_REVERSAL
+20

The original ledger entry remains unchanged.

## 11.23 Duplicate Movement Protection

Every movement originating from a business document must support
duplicate detection.

The same source document and source line must not accidentally create
multiple physical inventory movements.

Idempotency keys should be supported for retryable operations.

## 11.24 Concurrency

Ledger creation and Inventory Balance updates must participate in the
same database transaction.

Concurrent movements must be protected against:

- Double issue
- Double reservation consumption
- Incorrect running balances
- Duplicate transfers
- Incorrect cost-layer consumption

The final PostgreSQL concurrency strategy will be defined during
implementation.

## 11.25 Auditability

Every ledger entry must remain traceable to:

- User
- Timestamp
- Inventory Item
- Warehouse
- Location
- Batch
- Serial
- Movement Type
- Quantity
- Cost
- Source Module
- Source Document
- Reference
- Reason

The ledger must provide sufficient information to reconstruct the
inventory history for audit and financial reconciliation.

## 11.26 FinanceOS Integration

Inventory Engine owns operational inventory movement and inventory
valuation data.

FinanceOS owns:

- General Ledger
- Journal Entries
- Accounting Periods
- Financial Statements
- Inventory accounting postings

Inventory Engine must provide FinanceOS with reliable inventory
movement and valuation information.

Inventory Engine must not duplicate the General Ledger.

## 11.27 Costing Configuration

Costing configuration must eventually support:

- Company-level default costing method
- Item-level costing method where permitted
- Warehouse-level configuration where required
- Effective date
- Financial period rules

Changes to costing configuration must be auditable.

## 11.28 Cost Recalculation

Cost recalculation must be controlled.

Historical completed movements must not be silently rewritten.

If a costing correction is required, the system must create a controlled
revaluation or adjustment process.

The final revaluation workflow will be designed with FinanceOS.

## 11.29 Reporting

The Inventory Ledger must support reports including:

- Stock Movement Report
- Stock Ledger
- Inventory Valuation
- Item Movement History
- Batch Movement History
- Serial Movement History
- Warehouse Movement
- Location Movement
- Receipt History
- Issue History
- Transfer History
- Adjustment History
- Scrap History

# 12. Physical Stock Count & Reconciliation

## 12.1 Purpose

Physical Stock Count provides a controlled process for comparing
physical inventory with the inventory quantities recorded by TEXZIUM ERP.

The process must identify differences, investigate variances, obtain
required approvals, and create controlled inventory adjustments.

## 12.2 Stock Count Scope

A stock count may be performed for:

- Entire Warehouse
- Warehouse Zone
- Specific Location
- Inventory Item
- Batch
- Serial Number
- Selected Inventory Category

The scope must be explicitly defined before the count begins.

## 12.3 Stock Count Lifecycle

The standard lifecycle is:

DRAFT
    ↓
OPEN
    ↓
COUNTING
    ↓
COUNT_COMPLETED
    ↓
VARIANCE_REVIEW
    ↓
APPROVAL
    ↓
POSTED
    ↓
CLOSED

A count may also be:

CANCELLED

after the appropriate validation.

## 12.4 Count Snapshot

When a stock count is opened, the system should capture the system
quantity applicable to the count scope.

The snapshot may include:

- Inventory Item
- Warehouse
- Location
- Batch
- Serial
- System On Hand Quantity
- System Reserved Quantity
- System Available Quantity
- Unit Cost
- System Inventory Value

The snapshot provides the baseline against which the physical count is
compared.

## 12.5 Physical Count

The counting process records the actual quantity physically observed.

For non-serialized inventory:

Physical Quantity:
97

For serialized inventory:

The actual serial numbers present must be recorded.

For batch-controlled inventory:

The actual quantity must be recorded against the appropriate batch.

## 12.6 Count Variance

Variance is calculated as:

Physical Quantity - System Quantity

Example:

System:
100

Physical:
97

Variance:
-3

Positive variance:

Physical Quantity > System Quantity

Negative variance:

Physical Quantity < System Quantity

Zero variance:

Physical Quantity = System Quantity

## 12.7 Reserved Inventory During Count

Reserved inventory must remain visible during stock counting.

The count process must distinguish:

- Physical On Hand
- Reserved
- Available

Physical counting must not silently release or consume reservations.

Any reservation impact must be handled through a separate controlled
workflow.

## 12.8 Count Freeze

Depending on the count scope, the system may temporarily restrict
inventory movements affecting the counted stock.

Possible controls include:

- Full warehouse movement freeze
- Location freeze
- Item freeze
- Batch freeze
- Serial freeze

The selected freeze strategy must be configurable.

## 12.9 Concurrent Movements

If inventory moves after the count snapshot but before posting the
variance, the system must detect the difference.

The system must not blindly overwrite the latest inventory balance with
the physical count.

The final reconciliation process must account for movements occurring
between snapshot and posting.

## 12.10 Recount

The system must support recounting when a variance exceeds configured
thresholds or when an authorized user requests verification.

A recount may be:

- Full recount
- Partial recount
- Specific item recount
- Specific batch recount
- Specific serial recount

The recount must remain auditable.

## 12.11 Variance Threshold

Companies may configure variance thresholds.

Examples:

Quantity threshold:
±5 units

Percentage threshold:
±2%

Value threshold:
₹10,000

Variances exceeding configured thresholds may require additional
approval.

## 12.12 Variance Investigation

A variance may require investigation before adjustment.

Investigation information may include:

- Counted By
- Verified By
- Reason
- Warehouse
- Location
- Batch
- Serial
- Supporting Remarks
- Supporting Document
- Photographic Evidence where DocumentOS is integrated

## 12.13 Adjustment

After approval, the variance may be posted as an Inventory Adjustment.

Negative variance:

System:
100

Physical:
97

Adjustment:
-3

Positive variance:

System:
100

Physical:
103

Adjustment:
+3

The adjustment must use the Inventory Movement Engine.

The stock count process must never directly modify inventory quantities.

## 12.14 Adjustment Ledger

Every posted variance must create an Inventory Ledger entry.

The ledger reference must identify the originating stock count and
count line.

Example:

referenceModule:
INVENTORY_COUNT

referenceId:
Stock Count ID

## 12.15 Serialized Stock Count

For serialized inventory, reconciliation must compare the expected
serial list with the physically observed serial list.

The system must identify:

- Missing Serials
- Unexpected Serials
- Duplicate Serials
- Wrong Location
- Wrong Status

Each discrepancy must be investigated before final posting.

## 12.16 Batch Stock Count

For batch-controlled inventory, reconciliation must preserve batch
identity.

Example:

System:

Batch A:
100

Physical:

Batch A:
90

Batch B:
10

The system must not treat this simply as:

Total:
100

The batch-level discrepancy must remain visible.

## 12.17 Location-Level Reconciliation

Stock counts must support reconciliation at location level.

Example:

Warehouse:
Delhi

Location A:
System 100
Physical 97
Variance -3

Location B:
System 50
Physical 53
Variance +3

The system must preserve both variances.

It must not automatically net them together unless an authorized
inventory transfer/reconciliation process explicitly does so.

## 12.18 Approval

Inventory adjustments generated from physical counts may require
approval.

Approval requirements may depend on:

- Quantity variance
- Monetary variance
- Item category
- Warehouse
- User role
- Company policy

The Inventory Engine must expose approval hooks rather than embedding
company-specific approval rules.

## 12.19 Posting

Posting a stock count means:

1. Validate count status.
2. Validate all required counts.
3. Validate approvals.
4. Recalculate current inventory position.
5. Determine final variance.
6. Create inventory adjustments.
7. Create ledger entries.
8. Update count status.
9. Record audit information.

All inventory changes must occur transactionally.

## 12.20 Count Cancellation

A count may be cancelled before posting.

Cancellation must:

- Preserve the count history
- Prevent further posting
- Preserve recorded physical counts
- Record cancellation user
- Record cancellation timestamp
- Record cancellation reason

Cancellation must not alter inventory balances.

## 12.21 Count Closure

After all required adjustments are posted, the count may be closed.

A closed count must become read-only.

Historical count data must not be deleted.

## 12.22 Audit Trail

Stock count audit information should include:

- Count ID
- User
- Timestamp
- Warehouse
- Location
- Inventory Item
- Batch
- Serial
- System Quantity
- Physical Quantity
- Variance
- Reason
- Approval
- Adjustment Reference
- Status

## 12.23 Reporting

The stock count architecture must support:

- Stock Count Summary
- Stock Count Detail
- Variance Report
- Warehouse Variance
- Location Variance
- Batch Variance
- Serial Variance
- Inventory Adjustment Report
- Count History
- Pending Approval Report

## 12.24 Integration with DocumentOS

Where required, stock counts may reference supporting documents through
DocumentOS.

Examples:

- Count sheets
- Photographs
- Investigation reports
- Approval documents
- Supporting evidence

DocumentOS remains responsible for document storage and lifecycle.

Inventory Engine remains responsible for inventory reconciliation.

## 12.25 Integration with FinanceOS

Inventory adjustments may create financial inventory valuation impacts.

Inventory Engine must provide the adjustment quantity and valuation
information required by FinanceOS.

FinanceOS remains responsible for accounting entries and General Ledger
posting.

## 12.26 Reconciliation Principle

Physical Stock Count must reconcile inventory without destroying the
historical movement trail.

The final result must always be explainable through:

Stock Count
→ Variance
→ Approval
→ Inventory Adjustment
→ Inventory Ledger

# 13. Inventory Engine API Architecture

## 13.1 API Design Principles

The Inventory Engine API must provide controlled access to inventory
operations.

All inventory-changing APIs must:

- Validate input
- Validate inventory state
- Validate permissions
- Validate business rules
- Execute database operations transactionally
- Create inventory ledger entries where applicable
- Create audit information
- Support idempotency where required
- Return deterministic results

Inventory quantities must never be modified directly by external
modules.

External modules must call Inventory Engine operations.

## 13.2 API Resource

Base resource:

/operations/inventory

The exact NestJS controller route may be finalized during implementation.

## 13.3 Reservation API

### Reserve Inventory

Operation:

POST /operations/inventory/reservations

Purpose:

Reserve available inventory for a business requirement.

Input should support:

- Inventory Item
- Quantity
- Warehouse
- Location
- Batch
- Serial
- Reference Module
- Reference ID
- User
- Remarks

Validation:

- Inventory Item must exist.
- Requested quantity must be positive.
- Available quantity must be sufficient.
- Warehouse/location must be valid where applicable.
- Batch/serial rules must be satisfied.

Result:

- Reservation ID
- Reserved Quantity
- Remaining Available Quantity
- Reservation Status

## 13.4 Release Reservation API

Operation:

POST /operations/inventory/reservations/{id}/release

Purpose:

Release previously reserved inventory.

Validation:

- Reservation must exist.
- Reservation must be active.
- Released quantity must not exceed reserved quantity.
- Already released reservations cannot be released again.

The operation must update reservation state and inventory availability
transactionally.

## 13.5 Pick API

Operation:

POST /operations/inventory/pick

Purpose:

Move reserved inventory into picked status.

Input:

- Inventory Item
- Reservation
- Quantity
- Warehouse
- Location
- Batch
- Serial
- User
- Reference

Validation:

- Reservation must be valid.
- Quantity must not exceed remaining reservable quantity.
- Inventory must exist at the applicable location.
- Serial and batch rules must be satisfied.

## 13.6 Pack API

Operation:

POST /operations/inventory/pack

Purpose:

Mark picked inventory as packed.

Input:

- Inventory Item
- Pick Reference
- Quantity
- Warehouse
- Location
- Batch
- Serial
- User

Validation:

- Pick quantity must exist.
- Packed quantity must not exceed picked quantity.
- Inventory traceability must remain intact.

## 13.7 Issue API

Operation:

POST /operations/inventory/issue

Purpose:

Issue inventory from the organization.

Examples:

- Sales Dispatch
- Project Material Issue
- Production Material Issue
- Spare Consumption
- Internal Consumption

Input should support:

- Inventory Item
- Quantity
- Warehouse
- Location
- Batch
- Serial
- Reference Module
- Reference ID
- User
- Remarks

Validation:

- Inventory Item must exist.
- Quantity must be positive.
- Sufficient stock must exist.
- Applicable reservations must be respected.
- Batch/serial rules must be satisfied.
- Costing method must be applied.

Result:

- Movement ID
- Issued Quantity
- Unit Cost
- Total Cost
- Remaining Stock

## 13.8 Receive API

Operation:

POST /operations/inventory/receive

Purpose:

Receive inventory into stock.

Sources may include:

- Purchase Receipt
- Production Receipt
- Customer Return
- Opening Stock
- Inventory Adjustment

Input:

- Inventory Item
- Quantity
- Warehouse
- Location
- Batch
- Serial
- Unit Cost
- Reference Module
- Reference ID
- User

The operation must:

1. Validate input.
2. Create or update applicable inventory balance.
3. Create cost layer where required.
4. Create ledger entry.
5. Create audit information.

## 13.9 Transfer API

Operation:

POST /operations/inventory/transfer

Purpose:

Move inventory between warehouses or locations.

Input:

- Inventory Item
- Source Warehouse
- Source Location
- Destination Warehouse
- Destination Location
- Quantity
- Batch
- Serial
- User
- Reference
- Remarks

The operation must create a balanced movement:

Transfer Out
+
Transfer In

Both sides must succeed or both must fail.

## 13.10 Adjustment API

Operation:

POST /operations/inventory/adjustments

Purpose:

Perform an authorized inventory quantity adjustment.

Adjustment types:

- Positive Adjustment
- Negative Adjustment
- Damage
- Scrap
- Stock Count Variance

Input:

- Inventory Item
- Quantity
- Warehouse
- Location
- Batch
- Serial
- Adjustment Type
- Reason
- Reference
- User

Adjustments must be permission-controlled.

Where configured, approval must be completed before posting.

## 13.11 Stock Count API

### Create Count

POST /operations/inventory/counts

Creates a physical stock count.

### Open Count

POST /operations/inventory/counts/{id}/open

Starts the count process.

### Record Count

POST /operations/inventory/counts/{id}/lines

Records physical quantities.

### Complete Count

POST /operations/inventory/counts/{id}/complete

Marks physical counting as completed.

### Review Variance

POST /operations/inventory/counts/{id}/review

Calculates and exposes variances.

### Approve Count

POST /operations/inventory/counts/{id}/approve

Approves the count for posting.

### Post Count

POST /operations/inventory/counts/{id}/post

Creates approved inventory adjustments.

### Cancel Count

POST /operations/inventory/counts/{id}/cancel

Cancels an unposted count.

## 13.12 Batch API

The Inventory Engine must provide batch-aware operations.

Supported operations may include:

- Create Batch
- Receive Batch
- Issue Batch
- Transfer Batch
- Inspect Batch
- Track Batch
- Query Batch History
- Query Batch Expiry

Batch APIs must preserve complete traceability.

## 13.13 Serial API

The Inventory Engine must provide serial-aware operations.

Supported operations may include:

- Register Serial
- Receive Serial
- Pick Serial
- Pack Serial
- Issue Serial
- Transfer Serial
- Return Serial
- Inspect Serial
- Track Serial History

A serial-controlled item must not permit quantities that violate its
serial rules.

## 13.14 Ledger API

Ledger APIs are primarily read-oriented.

Examples:

GET /operations/inventory/ledger

GET /operations/inventory/ledger/{id}

Filters may include:

- Inventory Item
- Warehouse
- Location
- Batch
- Serial
- Movement Type
- Reference Module
- Reference ID
- Date Range
- User

Ledger records must not be directly edited through normal APIs.

## 13.15 Inventory Balance API

Example:

GET /operations/inventory/balances

Filters:

- Inventory Item
- Warehouse
- Location
- Batch
- Serial
- Condition

The API should expose:

- Stock Quantity
- Reserved Quantity
- Available Quantity
- Unit Cost
- Inventory Value

## 13.16 Inventory Valuation API

Example:

GET /operations/inventory/valuation

Supported dimensions:

- Item
- Warehouse
- Location
- Batch
- Cost Layer
- Date
- Costing Method

The API must return valuation information suitable for FinanceOS.

## 13.17 Idempotency

Inventory-changing operations must support idempotency.

Example:

A Dispatch Order attempts to issue stock.

The request succeeds.

The network fails before the caller receives the response.

The caller retries.

The Inventory Engine must recognize the duplicate request and must not
issue the stock twice.

Idempotency should use:

- Idempotency Key
- Source Module
- Source Document
- Source Line where applicable

## 13.18 Transaction Boundary

Every physical inventory operation must define a database transaction
boundary.

Example Issue:

BEGIN TRANSACTION

Validate inventory
Validate reservation
Validate batch/serial
Calculate cost
Update inventory balance
Consume cost layer
Create ledger
Create audit
Commit

Any failure must rollback the complete operation.

## 13.19 Error Handling

Inventory APIs must return consistent business errors.

Examples:

INVENTORY_ITEM_NOT_FOUND

INSUFFICIENT_STOCK

INSUFFICIENT_AVAILABLE_STOCK

INSUFFICIENT_RESERVED_STOCK

INVALID_WAREHOUSE

INVALID_LOCATION

INVALID_BATCH

INVALID_SERIAL

SERIAL_ALREADY_ISSUED

RESERVATION_NOT_FOUND

RESERVATION_ALREADY_RELEASED

INVALID_QUANTITY

DUPLICATE_MOVEMENT

PERIOD_CLOSED

APPROVAL_REQUIRED

COUNT_NOT_READY

COUNT_ALREADY_POSTED

## 13.20 Permission Hooks

Inventory operations must expose permission hooks.

Examples:

inventory.view

inventory.reserve

inventory.release

inventory.pick

inventory.pack

inventory.issue

inventory.receive

inventory.transfer

inventory.adjust

inventory.count

inventory.approve

inventory.post

inventory.ledger.view

inventory.valuation.view

The final permission codes must follow AdminOS Permission Matrix
standards.

## 13.21 Approval Hooks

Approval may be required for:

- High-value adjustments
- Large quantity adjustments
- Stock count variances
- Scrap
- Damage
- Revaluation
- Exceptional transfers

The Inventory Engine must call the centralized Approval Matrix rather
than implementing a separate approval engine.

## 13.22 Audit Hooks

Inventory-changing operations must expose audit information.

Audit should identify:

- User
- Operation
- Inventory Item
- Quantity
- Warehouse
- Location
- Batch
- Serial
- Reference
- Timestamp
- Result

The centralized Audit Trail Standard must remain the authoritative audit
mechanism.

## 13.23 Response Standard

Successful mutation responses should provide enough information for the
calling module to continue its workflow.

Typical response:

{
  id,
  status,
  quantity,
  unitCost,
  totalCost,
  remainingStock,
  referenceId
}

The exact DTO response contracts will be finalized during API
implementation.

## 13.24 Cross-Module Usage

Other TEXZIUM modules must call Inventory Engine rather than modifying
inventory directly.

Examples:

ProcurementOS
→ Receive Inventory

RevenueOS / Dispatch
→ Reserve / Pick / Pack / Issue

ProductionOS
→ Issue Raw Material / Receive Finished Goods

ProjectOS
→ Issue Project Material

ServiceOS
→ Issue Spare

RMAOS
→ Receive Return

AssetOS
→ Issue Asset

Inventory Count
→ Adjustment

This establishes Inventory Engine as the central inventory authority.

## 13.25 API Security

Inventory APIs must require authenticated users.

Authorization must be evaluated using AdminOS permissions.

Sensitive operations must additionally evaluate:

- Company
- Warehouse
- User Scope
- Role
- Approval Status
- Financial Period

## 13.26 API Versioning

The Inventory Engine API should support versioned contracts.

Initial target:

v1

Example:

/api/v1/operations/inventory

Future breaking changes must use a new API version rather than silently
changing existing contracts.

## 13.27 API Documentation

All Inventory Engine APIs must eventually be documented using OpenAPI /
Swagger.

Documentation should include:

- Request DTO
- Response DTO
- Validation Rules
- Authorization Requirements
- Error Codes
- Examples
- Transaction Behavior
- Idempotency Behavior

# 14. Inventory Engine Integration Architecture

## 14.1 Integration Principle

Inventory Engine is the central operational authority for inventory
quantity, inventory movement, reservation, warehouse stock, batch
tracking, serial tracking, inventory ledger, and inventory valuation
data.

Other modules must not directly modify Inventory Engine database records.

All inventory-changing operations must pass through Inventory Engine
services or approved integration interfaces.

## 14.2 ProcurementOS Integration

ProcurementOS is responsible for:

- Purchase Requisition
- Purchase Order
- Supplier workflow
- Procurement approvals

Inventory Engine is responsible for:

- Receipt of physical inventory
- Inventory quantity
- Warehouse assignment
- Batch tracking
- Serial tracking
- Inventory valuation
- Inventory ledger

Typical flow:

Purchase Order
    ↓
Goods Receipt
    ↓
Inventory Engine Receive
    ↓
Inventory Balance
    ↓
Inventory Ledger

ProcurementOS must not directly update inventory quantity.

## 14.3 RevenueOS Integration

RevenueOS is responsible for:

- Customer
- Sales Order
- Commercial pricing
- Sales workflow

Inventory Engine is responsible for:

- Reservation
- Picking
- Packing
- Issue
- Inventory reduction
- Inventory traceability

Typical flow:

Sales Order
    ↓
Inventory Reservation
    ↓
Pick
    ↓
Pack
    ↓
Dispatch
    ↓
Inventory Issue
    ↓
Inventory Ledger

## 14.4 Dispatch Integration

Dispatch is an important Inventory Engine consumer.

Dispatch Order must reference inventory information but should not
implement independent stock calculation logic.

Typical flow:

Dispatch Order
    ↓
Dispatch Order Item
    ↓
Inventory Reservation
    ↓
Inventory Pick
    ↓
Inventory Pack
    ↓
Inventory Issue
    ↓
DISPATCHED

Dispatch completion must preserve:

- Inventory Item
- Quantity
- Warehouse
- Location
- Batch
- Serial
- Inventory Movement
- Ledger Reference

## 14.5 ProductionOS Integration

ProductionOS is responsible for manufacturing workflow.

Inventory Engine provides:

### Material Issue

Production consumes raw or semi-finished material through Inventory
Engine.

Example:

Production Order
    ↓
Material Requirement
    ↓
Inventory Reservation
    ↓
Material Pick
    ↓
Material Issue
    ↓
Production

### Finished Goods Receipt

Production completion may generate:

Production Output
    ↓
Inventory Receive
    ↓
Finished Goods Stock

Inventory Engine must not own production planning or manufacturing
logic.

## 14.6 Warehouse Integration

Warehouse functionality may include:

- Receiving
- Putaway
- Picking
- Packing
- Transfers
- Location management

Inventory Engine owns the authoritative inventory state.

Warehouse workflows call Inventory Engine for inventory-changing
operations.

The relationship is:

Warehouse Workflow
        ↓
Inventory Engine
        ↓
Inventory Balance + Ledger

## 14.7 ProjectOS Integration

ProjectOS may consume inventory for project execution.

Example:

Project
    ↓
Material Requirement
    ↓
Inventory Reservation
    ↓
Inventory Issue
    ↓
Project Cost

Inventory Engine records the physical inventory movement.

ProjectOS records project consumption and project costing relationships.

## 14.8 ServiceOS Integration

ServiceOS may consume spare parts during service activities.

Example:

Service Ticket
    ↓
Spare Requirement
    ↓
Inventory Reservation
    ↓
Spare Issue
    ↓
Inventory Ledger
    ↓
Service Cost

Inventory Engine owns the inventory movement.

ServiceOS owns service workflow.

## 14.9 RMAOS Integration

RMAOS manages return authorization and return workflow.

Inventory Engine manages the physical inventory movement.

Example:

Customer Return
    ↓
RMA
    ↓
Inventory Receive
    ↓
QC
    ↓
Available / Quarantine / Scrap

Returned inventory must not automatically become available.

Quality and disposition rules must determine the final inventory status.

## 14.10 AssetOS Integration

AssetOS may create or manage assets associated with serialized
inventory.

Example:

Serialized Inventory
    ↓
Issue
    ↓
Installation
    ↓
Asset Registration

Inventory Engine maintains:

- Serial identity
- Inventory history
- Movement history

AssetOS maintains:

- Asset lifecycle
- Asset ownership
- Depreciation relationship
- Asset-specific information

Inventory Engine must not duplicate AssetOS depreciation logic.

## 14.11 WarrantyOS Integration

Warranty functionality may reference serial numbers.

Example:

Serial Number
    ↓
Installation
    ↓
Warranty
    ↓
Service

Inventory Engine provides serial identity and movement history.

WarrantyOS owns warranty policy and warranty calculation.

## 14.12 DocumentOS Integration

Inventory Engine may reference documents stored by DocumentOS.

Examples:

- Goods Receipt documents
- Stock Count Sheets
- Inspection Reports
- Adjustment approvals
- Damage evidence
- Scrap authorization
- Supplier documents

Inventory Engine should store document references rather than duplicate
DocumentOS file storage.

DocumentOS remains the document repository.

## 14.13 FinanceOS Integration

Inventory Engine provides operational inventory valuation information
to FinanceOS.

Typical flow:

Inventory Movement
    ↓
Inventory Valuation
    ↓
FinanceOS
    ↓
Accounting Entry
    ↓
General Ledger

FinanceOS owns:

- General Ledger
- Accounting Entries
- Financial Periods
- Financial Reporting

Inventory Engine owns:

- Quantity
- Movement
- Operational valuation
- Cost layers

The accounting boundary must remain explicit.

## 14.14 ComplianceOS Integration

Inventory Engine may provide information required for compliance.

Examples:

- HSN
- Batch information
- Serial information
- Goods movement
- Tax-related inventory references

ComplianceOS remains responsible for statutory compliance logic.

Inventory Engine must not duplicate GST, E-Invoice, or E-Way Bill
business logic.

## 14.15 AdminOS Integration

AdminOS provides centralized control for Inventory Engine.

Inventory Engine should consume:

- User permissions
- Roles
- Warehouse access
- Approval rules
- Numbering configuration
- Company settings
- Period controls

Inventory Engine must not create a separate permission engine.

## 14.16 Audit Integration

All significant inventory operations must integrate with the centralized
Audit Trail.

Examples:

- Reservation
- Release
- Pick
- Pack
- Issue
- Receive
- Transfer
- Adjustment
- Stock Count
- Batch registration
- Serial registration

Audit information must identify:

- User
- Timestamp
- Operation
- Source Module
- Reference
- Inventory Item
- Quantity
- Warehouse
- Location

## 14.17 Approval Integration

Inventory Engine must use the centralized Approval Matrix.

Potential approval-controlled operations:

- Large stock adjustments
- Scrap
- Stock count variances
- High-value adjustments
- Inventory revaluation
- Exceptional transfers

Inventory Engine exposes approval hooks.

AdminOS owns approval configuration.

## 14.18 Notification Integration

Inventory Engine may emit notification events for:

- Low stock
- Reservation failure
- Stock count variance
- Approval required
- Stock adjustment posted
- Transfer completed
- Batch expiry
- Serial exception

Notification delivery remains centralized.

Inventory Engine must not implement its own notification infrastructure.

## 14.19 Event Integration

Inventory Engine may publish domain events after successful transactions.

Examples:

InventoryReserved
InventoryReleased
InventoryPicked
InventoryPacked
InventoryIssued
InventoryReceived
InventoryTransferred
InventoryAdjusted
StockCountCompleted
StockCountPosted
SerialRegistered
BatchRegistered

Events must only be published after the underlying database transaction
has successfully committed.

## 14.20 Event Consumers

Other modules may consume Inventory Engine events.

Example:

InventoryIssued
    ↓
RevenueOS
    → Update Dispatch State

InventoryIssued
    ↓
ProjectOS
    → Update Project Consumption

InventoryIssued
    ↓
ServiceOS
    → Update Spare Consumption

InventoryReceived
    ↓
ProcurementOS
    → Update Receipt Status

InventoryReceived
    ↓
FinanceOS
    → Process Inventory Accounting

InventoryAdjusted
    ↓
FinanceOS
    → Process Adjustment Accounting

## 14.21 Integration Ownership

The following ownership must remain fixed.

| Capability | Owner |
|---|---|
| Inventory Quantity | Inventory Engine |
| Inventory Movement | Inventory Engine |
| Reservation | Inventory Engine |
| Warehouse Stock | Inventory Engine |
| Batch Tracking | Inventory Engine |
| Serial Tracking | Inventory Engine |
| Inventory Ledger | Inventory Engine |
| Inventory Costing | Inventory Engine |
| Stock Count | Inventory Engine |
| Inventory Valuation | Inventory Engine |
| Procurement Workflow | ProcurementOS |
| Sales Workflow | RevenueOS |
| Dispatch Workflow | OperationsOS / Dispatch |
| Production Workflow | ProductionOS |
| Project Workflow | ProjectOS |
| Service Workflow | ServiceOS |
| Asset Lifecycle | AssetOS |
| Warranty Lifecycle | WarrantyOS |
| RMA Workflow | RMAOS |
| Accounting | FinanceOS |
| Compliance | ComplianceOS |
| Documents | DocumentOS |
| Permissions | AdminOS |
| Approvals | AdminOS |
| Audit | Central Audit System |
| Notifications | Central Notification Engine |

## 14.22 Direct Database Access Rule

No external module may directly update:

- Inventory quantity
- Reserved quantity
- Available quantity
- Inventory ledger
- Cost layers
- Serial status
- Batch stock
- Inventory reservations

External modules must use Inventory Engine interfaces.

Read-only reporting access may be exposed through approved query services
or APIs.

## 14.23 Transaction Ownership

The module initiating the business workflow does not automatically own
the inventory transaction.

Inventory Engine owns the inventory transaction.

Example:

Dispatch Order belongs to Dispatch.

But:

Inventory Issue belongs to Inventory Engine.

This separation prevents inventory logic from being duplicated across
business modules.

## 14.24 Failure Handling

If an inventory operation fails:

- Inventory Balance must remain unchanged.
- Inventory Ledger must remain unchanged.
- Reservation state must remain consistent.
- Cost layers must remain consistent.
- Serial state must remain consistent.
- Batch state must remain consistent.

The complete inventory transaction must rollback.

External business workflows must receive a deterministic failure result.

## 14.25 Integration Security

Every cross-module inventory request must identify:

- Authenticated User
- Source Module
- Company
- Reference Document
- Reference Line where applicable

The Inventory Engine must validate that the caller has permission to
perform the requested inventory operation.

## 14.26 Integration Idempotency

Cross-module inventory operations must support idempotency.

Example:

RevenueOS sends:

ISSUE
Reference:
DISPATCH_ORDER-1001
Line:
1

If the request is retried, Inventory Engine must detect that the
movement has already been successfully posted.

The same physical inventory must never be issued twice because of a
network retry.

## 14.27 Integration Architecture Rule

Business modules own business workflows.

Inventory Engine owns inventory state.

FinanceOS owns accounting.

AdminOS owns centralized controls.

DocumentOS owns documents.

This separation must be preserved throughout implementation.

## 14.28 Inventory Engine Final Responsibility

Inventory Engine is responsible for answering:

- What inventory do we have?
- Where is it?
- How much is available?
- How much is reserved?
- Which batch is it from?
- Which serial is it?
- What movements occurred?
- What did the inventory cost?
- What is the inventory worth?
- Why did the quantity change?
- Which document caused the movement?

Inventory Engine is not responsible for answering:

- Which customer should be sold to?
- Which supplier should be selected?
- How should production be planned?
- How should a project be managed?
- How should an employee perform service?
- How should an asset be depreciated?
- How should GST be calculated?
- How should the General Ledger be maintained?

Those responsibilities belong to their respective TEXZIUM ERP modules.

# Phase 1 — Warehouse & Location Architecture

## 1. Objective

Establish the physical warehouse and storage-location foundation for Inventory Engine V2.

The location hierarchy is:

Warehouse
→ Warehouse Zone
→ Warehouse Rack
→ Warehouse Bin

## 2. Warehouse

Warehouse represents a physical inventory storage facility.

Core attributes:

- id
- code
- name
- description
- status
- address
- createdAt
- updatedAt

Warehouse code must be unique.

## 3. Warehouse Zone

Warehouse Zone represents a logical section within a warehouse.

Relationship:

Warehouse 1 → N WarehouseZone

Core attributes:

- id
- warehouseId
- code
- name
- description
- status
- createdAt
- updatedAt

Zone code must be unique within a warehouse.

## 4. Warehouse Rack

Warehouse Rack represents a rack/storage structure within a warehouse zone.

Relationship:

WarehouseZone 1 → N WarehouseRack

Core attributes:

- id
- zoneId
- code
- name
- description
- status
- createdAt
- updatedAt

Rack code must be unique within a zone.

## 5. Warehouse Bin

Warehouse Bin represents the final physical storage location.

Relationship:

WarehouseRack 1 → N WarehouseBin

Core attributes:

- id
- rackId
- code
- name
- description
- status
- capacity
- createdAt
- updatedAt

Bin code must be unique within a rack.

## 6. Location Hierarchy

Warehouse
└── Zone
    └── Rack
        └── Bin

## 7. Legacy Compatibility

Existing inventory location fields remain temporarily:

- InventoryItem.warehouse
- InventoryTransaction.warehouseId
- InventoryTransaction.binLocation
- DispatchOrder.warehouseId
- DispatchOrderItem.warehouseId
- DispatchOrderItem.binLocation
- WarehousePutaway.warehouseName
- WarehousePutaway.zoneName
- WarehousePutaway.rackNumber
- WarehousePutaway.binNumber

These fields will not be removed during Phase 1.

Migration to relational location references will occur in a later compatibility phase.

## 8. Future Inventory Integration

InventoryBalance V2 will reference:

- warehouseId
- binId

This will allow stock to be tracked by physical location.

Future batch and serial tracking will extend the inventory balance model.

## 9. Design Principle

Warehouse and location masters are foundational infrastructure.

Inventory quantities must not depend on free-text warehouse or bin names in the V2 architecture.

# Phase 2 — Inventory Balance Architecture

## 1. Objective

InventoryBalance is the authoritative V2 stock-position model.

It represents the quantity of a specific InventoryItem at a specific physical inventory location, with optional batch and serial traceability.

## 2. Inventory Balance

InventoryBalance represents one inventory position.

Core attributes:

- id
- inventoryItemId
- warehouseId
- binId
- batchId
- serialId
- onHandQty
- reservedQty
- availableQty
- status
- createdAt
- updatedAt

## 3. Quantity Model

The quantity relationship is:

Available Quantity = On Hand Quantity - Reserved Quantity

The system must maintain:

- onHandQty >= 0
- reservedQty >= 0
- availableQty >= 0
- reservedQty <= onHandQty

## 4. Physical Location

Every InventoryBalance belongs to a Warehouse.

A balance may optionally reference a WarehouseBin during transitional implementation.

V2 inventory transactions should progressively use relational warehouse and bin references instead of free-text location fields.

## 5. Batch Association

batchId is nullable.

For non-batch-controlled inventory:

batchId = null

For batch-controlled inventory:

batchId references the applicable inventory batch.

## 6. Serial Association

serialId is nullable.

For non-serialized inventory:

serialId = null

For serialized inventory:

serialId references the applicable inventory serial record.

A serialized inventory balance normally represents one serialized unit.

## 7. Uniqueness

The system must prevent duplicate inventory positions.

The logical uniqueness rule is:

InventoryItem + Warehouse + Bin + Batch + Serial

Only one active InventoryBalance should represent the same inventory position.

## 8. Reservation

Reservation changes only the reserved quantity.

Reservation:

onHandQty remains unchanged.

reservedQty increases.

availableQty decreases.

Formula:

availableQty = onHandQty - reservedQty

## 9. Issue

Issue decreases physical stock.

Issue:

onHandQty decreases.

reservedQty decreases when the issue consumes reserved stock.

availableQty is recalculated.

## 10. Receipt

Receipt increases physical stock.

Receipt:

onHandQty increases.

availableQty increases when the received quantity is not already reserved.

## 11. Transfer

A transfer moves stock between inventory positions.

Source balance:

onHandQty decreases.

Destination balance:

onHandQty increases.

The transfer must be represented as an atomic business operation.

## 12. Adjustment

Stock adjustment changes onHandQty based on an approved adjustment.

Every adjustment must create an inventory movement/ledger record.

## 13. Status

InventoryBalance status will support future inventory controls such as:

- ACTIVE
- BLOCKED
- QUARANTINED
- HOLD
- CLOSED

The exact status transition rules will be defined in the Inventory Movement and Quality phases.

## 14. Legacy Compatibility

Existing InventoryItem quantity fields remain temporarily:

- stockQty
- reservedQty
- availableQty
- warehouse

They will not be removed during Phase 2.

InventoryBalance becomes the V2 foundation while legacy fields are migrated progressively.

## 15. Authority Rule

During the final V2 architecture:

InventoryBalance becomes the authoritative operational stock-position source.

InventoryItem remains the inventory/product-level master and must not be used as the primary warehouse-level stock ledger.

## 16. Future Extensions

InventoryBalance will integrate with:

- InventoryMovement
- InventoryLedger
- InventoryReservation
- Warehouse
- WarehouseBin
- InventoryBatch
- InventorySerial
- CostLayer
- StockCount
- StockAdjustment

# Phase 3 — Batch & Serial Traceability Architecture

## 1. Objective

Inventory Engine V2 must support both batch-controlled and serialized inventory.

Batch and serial traceability must integrate with InventoryItem, InventoryBalance, InventoryMovement, DispatchOrder, Warranty, RMA, Service, and ProductTag.

## 2. Inventory Batch

InventoryBatch represents a traceable batch or lot of an InventoryItem.

Core attributes:

- id
- inventoryItemId
- batchNumber
- manufactureDate
- expiryDate
- receivedDate
- status
- remarks
- createdAt
- updatedAt

Batch number must be unique within the applicable inventory item.

## 3. Batch Lifecycle

A batch may move through lifecycle states such as:

- ACTIVE
- QUARANTINED
- BLOCKED
- EXPIRED
- CLOSED

The exact transition rules will be defined by Inventory Movement and Quality architecture.

## 4. Inventory Serial

InventorySerial represents one individually traceable physical unit.

Core attributes:

- id
- inventoryItemId
- batchId
- serialNumber
- status
- warehouseId
- binId
- warrantyStartDate
- warrantyEndDate
- createdAt
- updatedAt

Serial number must be globally unique within the ERP inventory system.

## 5. Serial Lifecycle

A serial may move through states such as:

- AVAILABLE
- RESERVED
- PICKED
- PACKED
- DISPATCHED
- INSTALLED
- IN_SERVICE
- RETURNED
- RMA
- SCRAPPED
- BLOCKED

The exact lifecycle transitions will be defined by the Inventory Movement and Service/RMA architecture.

## 6. Batch vs Serial

Batch-controlled inventory tracks quantities by batch.

Example:

InventoryItem + Warehouse + Bin + Batch

Serialized inventory tracks individual units.

Example:

InventoryItem + Warehouse + Bin + Batch + Serial

A serialized unit represents one physical unit.

## 7. Inventory Balance Integration

InventoryBalance may reference:

- batchId
- serialId

Both are nullable.

Non-batch inventory:

batchId = null

Non-serialized inventory:

serialId = null

Batch-controlled inventory:

batchId != null

Serialized inventory:

serialId != null

## 8. Serial Location

A serialized unit must have a current physical location when it is physically held by the company.

The location is represented through:

- warehouseId
- binId

Location changes must be recorded through InventoryMovement.

## 9. Traceability

Every batch and serial movement must be traceable through the Inventory Engine.

The system must support tracing:

Receipt
→ Putaway
→ Storage
→ Reservation
→ Pick
→ Pack
→ Dispatch
→ Installation
→ Service
→ Return/RMA

## 10. ProductTag Integration

The existing ProductTag model contains:

- serialNumber
- qrCode
- tagStatus
- dispatchStatus
- warrantyStatus

ProductTag will remain during the V2 migration.

InventorySerial becomes the authoritative inventory serial identity.

ProductTag becomes the operational/product-tag representation associated with the serial unit rather than a second independent serial master.

## 11. Dispatch Integration

DispatchOrderItem currently contains:

- serialNumber
- batchNumber

These fields remain temporarily for backward compatibility.

V2 dispatch processing will progressively reference:

- inventoryBatchId
- inventorySerialId

rather than relying on free-text batch and serial values.

## 12. Warranty Integration

Serialized inventory provides the foundation for unit-level warranty tracking.

Warranty records should reference the applicable InventorySerial where unit-level traceability is required.

## 13. RMA Integration

Returned serialized products must preserve the original serial identity.

An RMA must not create a new serial for an existing physical unit.

The existing serial lifecycle must be updated according to the return condition and disposition.

## 14. Rules

1. Serial numbers must be unique.
2. A serialized unit represents one physical unit.
3. A serial cannot simultaneously occupy two physical locations.
4. A dispatched serial cannot remain AVAILABLE.
5. A blocked or quarantined serial cannot be normally issued.
6. Batch and serial movements must be auditable.
7. Serial location changes must create InventoryMovement records.
8. Batch traceability must be retained after dispatch.
9. Historical serial identity must never be overwritten.
10. Legacy serial fields remain temporarily during migration.

## 15. Legacy Compatibility

Existing fields remain temporarily:

- ProductTag.serialNumber
- DispatchOrderItem.serialNumber
- DispatchOrderItem.batchNumber

They will not be removed during this phase.

Migration will establish InventorySerial as the authoritative serial identity.

## 16. Future Integration

InventoryBatch and InventorySerial will integrate with:

- InventoryBalance
- InventoryMovement
- InventoryLedger
- InventoryReservation
- Warehouse
- WarehouseBin
- GoodsReceipt
- QualityInspection
- DispatchOrder
- Installation
- Warranty
- ServiceTicket
- RMA

# Phase 4 — Inventory Movement Architecture

## 1. Objective

InventoryMovement is the authoritative business event representing a change in inventory quantity, location, reservation state, or inventory status.

All stock-changing operations must pass through the Inventory Engine movement layer.

## 2. Movement Types

The V2 Inventory Engine will support:

- RECEIPT
- ISSUE
- RESERVATION
- RELEASE
- TRANSFER
- ADJUSTMENT_IN
- ADJUSTMENT_OUT
- RETURN
- PICK
- PACK
- PUTAWAY
- SCRAP

Additional movement types may be introduced when required by other OperationsOS modules.

## 3. Movement Structure

Every movement must identify:

- id
- movementType
- inventoryItemId
- warehouseId
- binId
- batchId
- serialId
- quantity
- referenceModule
- referenceId
- reason
- createdBy
- createdAt

For transfers, both source and destination inventory positions must be represented.

## 4. Quantity Direction

Inventory movement quantity follows a consistent direction.

Inbound movement:

quantity > 0

Outbound movement:

quantity > 0 but movementType determines the business direction.

The system must not rely solely on negative numbers to determine business meaning.

Movement type is authoritative.

## 5. Receipt

Receipt increases physical stock.

Flow:

Goods Receipt
→ Inventory Movement RECEIPT
→ Inventory Balance increases
→ Inventory Ledger entry

Receipt may subsequently trigger:

Putaway
→ Warehouse
→ Bin

## 6. Issue

Issue decreases physical stock.

Flow:

Reservation
→ Pick
→ Pack
→ Issue
→ Inventory Balance decreases
→ Inventory Ledger entry

Issue must validate:

- sufficient on-hand quantity
- sufficient reserved quantity when consuming reservation
- valid warehouse/location
- valid batch where applicable
- valid serial where applicable

## 7. Reservation

Reservation does not change physical on-hand quantity.

Reservation changes:

reservedQty ↑
availableQty ↓

The movement must record the reservation reference.

## 8. Release

Release reverses an existing reservation.

Release changes:

reservedQty ↓
availableQty ↑

A release must not increase physical on-hand quantity.

## 9. Transfer

Transfer moves stock from one inventory position to another.

Source:

onHandQty ↓

Destination:

onHandQty ↑

A transfer must be atomic.

If either side fails, the complete transfer must roll back.

Transfer must preserve:

- inventory item
- batch
- serial
- source warehouse
- source bin
- destination warehouse
- destination bin

## 10. Adjustment

Adjustment changes physical stock because of an approved stock correction.

Adjustment types:

ADJUSTMENT_IN
ADJUSTMENT_OUT

Every adjustment must contain a reason and reference.

Manual quantity modification without an InventoryMovement record is prohibited in the final V2 architecture.

## 11. Return

A returned item creates an inbound inventory movement.

Return processing must preserve the original:

- inventory item
- batch
- serial

The destination condition may determine whether stock becomes:

- AVAILABLE
- QUARANTINED
- REPAIR
- SCRAP

## 12. Pick

Pick represents physical movement from storage toward dispatch preparation.

Pick does not represent final stock issue.

The physical inventory position and dispatch workflow must remain distinguishable.

## 13. Pack

Pack represents preparation of picked inventory for dispatch.

Pack does not itself represent final ownership/stock issue unless explicitly configured by the business workflow.

## 14. Putaway

Putaway establishes the final warehouse/bin location of received inventory.

Putaway must preserve:

- warehouse
- bin
- batch
- serial
- quantity

## 15. Scrap

Scrap permanently removes inventory from usable stock.

Scrap must require:

- reason
- quantity
- approval where configured
- reference
- audit information

Serialized scrap must preserve the serial history.

## 16. Transaction Atomicity

Every movement that changes inventory quantities must execute inside a database transaction.

The transaction must update:

1. InventoryBalance
2. InventoryMovement
3. InventoryLedger
4. Related business document where required

All operations must succeed or all changes must roll back.

## 17. Concurrency

Inventory movements must protect against concurrent stock modification.

The system must prevent:

- double issue
- double reservation
- negative available stock
- negative reserved stock
- duplicate serial assignment
- duplicate stock transfer

Database transactions and appropriate locking/concurrency controls must be used.

## 18. Idempotency

Inventory movement APIs must support idempotent processing where external systems or asynchronous jobs may retry the same operation.

A repeated request must not create duplicate inventory movement.

The exact idempotency-key implementation will be defined in the API architecture.

## 19. Reference Tracking

Every movement should identify the originating business transaction.

Examples:

Sales Order
Purchase Order
Goods Receipt
Dispatch Order
RMA
Service Ticket
Stock Adjustment
Stock Count
Project
Production Order

The movement must retain:

referenceModule
referenceId

## 20. Audit

Every inventory movement must preserve:

- who performed the operation
- when it occurred
- what quantity changed
- which inventory item changed
- warehouse
- bin
- batch
- serial
- source document
- reason

Inventory history must be immutable.

## 21. Ledger Integration

InventoryMovement represents the operational inventory event.

InventoryLedger represents the historical inventory balance/value record.

The relationship is:

Business Transaction
→ InventoryMovement
→ InventoryBalance update
→ InventoryLedger entry

## 22. Legacy Compatibility

Existing InventoryTransaction remains temporarily.

Existing services may continue to use it during migration.

Final V2 architecture will migrate inventory-changing operations to InventoryMovement and InventoryLedger.

Existing direct updates to:

- stockQty
- reservedQty
- availableQty

must progressively be removed from business modules.

## 23. Authority Rule

No OperationsOS module should directly modify inventory quantities in the final architecture.

Modules must request inventory operations through the Inventory Engine.

Examples:

GoodsReceipt
→ Inventory Engine RECEIVE

Dispatch
→ Inventory Engine ISSUE

RMA
→ Inventory Engine RETURN

Stock Count
→ Inventory Engine ADJUSTMENT

Warehouse Transfer
→ Inventory Engine TRANSFER

## 24. Movement Lifecycle

The general lifecycle is:

Business Request
→ Validation
→ Authorization
→ Inventory Movement
→ Inventory Balance Update
→ Inventory Ledger
→ Audit
→ Business Document Update

## 25. Future Extensions

InventoryMovement will integrate with:

- InventoryBalance
- InventoryLedger
- CostLayer
- Warehouse
- WarehouseBin
- InventoryBatch
- InventorySerial
- InventoryReservation
- StockCount
- StockAdjustment
- Procurement
- Sales
- Dispatch
- Service
- RMA
- Production
- ProjectOS
# Phase 5 — Inventory Reservation Architecture

## 1. Objective

Inventory Reservation represents a commitment of available inventory to a business requirement without physically reducing on-hand inventory.

The reservation engine is responsible for:

- reserving inventory
- partially reserving inventory
- releasing inventory
- cancelling reservations
- expiring reservations
- validating available quantity
- preventing over-reservation
- maintaining reservation history

## 2. Reservation Model

A reservation must identify:

- id
- inventoryBalanceId
- inventoryItemId
- warehouseId
- binId
- batchId
- serialId
- requestedQty
- reservedQty
- releasedQty
- status
- reservationType
- referenceModule
- referenceId
- priority
- expiryDate
- reservedBy
- createdAt
- updatedAt

## 3. Reservation Status

Supported statuses:

- PENDING
- PARTIALLY_RESERVED
- RESERVED
- PARTIALLY_RELEASED
- RELEASED
- CANCELLED
- EXPIRED

Status transitions must be controlled by the Reservation Engine.

## 4. Reservation Quantity

The reservation quantity model is:

requestedQty = original requested quantity

reservedQty = quantity currently reserved

releasedQty = quantity released from the reservation

Active reserved quantity is:

reservedQty - releasedQty

The system must never allow:

reservedQty < releasedQty

## 5. Reservation Validation

Before creating or increasing a reservation:

availableQty must be greater than or equal to the requested reservation quantity.

The system must prevent:

- negative available quantity
- reserved quantity greater than on-hand quantity
- duplicate reservation processing
- reservation against blocked inventory
- reservation against quarantined inventory
- reservation against expired inventory
- reservation against unavailable serials

## 6. Partial Reservation

If the requested quantity cannot be fully reserved, the engine may support partial reservation where the business workflow permits it.

Example:

Requested:

100 units

Available:

60 units

Result:

60 units reserved
40 units remaining

Status:

PARTIALLY_RESERVED

Partial reservation must be explicitly allowed by the requesting business transaction.

## 7. Reservation Release

Release decreases the active reservation.

Release does not modify physical on-hand quantity.

Example:

On hand:

100

Reserved:

60

Available:

40

Release:

20

Result:

On hand:

100

Reserved:

40

Available:

60

## 8. Full Release

When the entire active reservation is released:

reservedQty = 0

availableQty = onHandQty

Reservation status becomes:

RELEASED

## 9. Cancellation

Cancellation terminates the reservation request.

If inventory has already been reserved, the active reservation quantity must first be released.

Cancellation must preserve the original reservation history.

Historical reservations must not be deleted.

## 10. Expiry

Reservations may contain an expiryDate.

An expired reservation must not continue consuming available inventory.

Expired reservations must be released according to the configured expiry process.

The expiry process must be auditable.

## 11. Priority

Reservations may have a priority level.

Example:

- LOW
- NORMAL
- HIGH
- CRITICAL

Priority may be used when allocating limited inventory between competing requests.

The final allocation algorithm will be defined separately.

## 12. Reservation Types

The engine may support:

- SALES_ORDER
- DISPATCH_ORDER
- PRODUCTION
- PROJECT
- SERVICE
- RMA
- MANUAL
- OTHER

The requesting module remains responsible for the business reason.

Inventory Engine remains responsible for inventory availability and reservation integrity.

## 13. Reference Tracking

Every reservation must identify its source:

referenceModule

referenceId

Examples:

SalesOrder
DispatchOrder
Project
ProductionOrder
ServiceTicket
RMA

The reservation must remain traceable to its originating business document.

## 14. Warehouse and Bin Reservation

Reservation must occur against a specific InventoryBalance where physical location is known.

The system should not reserve stock against only a free-text warehouse name in the final V2 architecture.

Reservation allocation should identify:

- warehouse
- bin
- batch where applicable
- serial where applicable

## 15. Batch Reservation

For batch-controlled inventory, reservations may target a specific batch.

Where batch selection is not explicitly provided, the Inventory Engine may select an eligible batch according to the configured allocation strategy.

Future allocation strategies may include:

- FIFO
- FEFO
- manual selection
- priority-based selection

## 16. Serial Reservation

For serialized inventory, reservation must identify the individual serial unit.

A serial may have only one active reservation at a time unless a future business rule explicitly allows otherwise.

## 17. Concurrency

Reservation operations must execute transactionally.

The engine must protect against two concurrent requests reserving the same available quantity.

Example:

Available quantity = 10

Request A = 8

Request B = 8

The final result must never produce:

reservedQty > onHandQty

One request may succeed while the other fails or is partially fulfilled according to the configured allocation policy.

## 18. Idempotency

Reservation requests must support idempotent processing.

Retrying the same reservation request must not create duplicate active reservations.

An idempotency key or equivalent unique business reference must be used where required.

## 19. Reservation and InventoryBalance

Reservation updates the InventoryBalance quantities:

reservedQty increases

availableQty decreases

onHandQty remains unchanged

The relationship remains:

availableQty = onHandQty - reservedQty

## 20. Reservation and InventoryMovement

Reservation creates an auditable inventory event.

The event must record:

- reservation action
- quantity
- inventory position
- reference document
- user
- timestamp

Reservation is a logical inventory commitment rather than a physical stock issue.

## 21. Reservation and Dispatch

Dispatch workflow may follow:

Sales Order
→ Reservation
→ Pick
→ Pack
→ Issue
→ Dispatch

Dispatch must not issue more inventory than the active reservation allocated to the dispatch requirement.

## 22. Reservation and Pick

Pick consumes or progresses the reservation according to the configured workflow.

The exact transition between reserved quantity and picked quantity must remain consistent across:

InventoryBalance
DispatchOrderItem
Reservation

## 23. Reservation and Issue

When reserved stock is issued:

onHandQty decreases

active reservation decreases

availableQty is recalculated

The complete operation must occur atomically.

## 24. Legacy Compatibility

Existing InventoryReservation remains temporarily.

Existing fields remain temporarily:

- InventoryItem.reservedQty
- InventoryItem.availableQty
- DispatchOrderItem.reservedQty
- DispatchOrderItem.isReserved

Existing ReserveService and InventoryReservationsService will be migrated progressively.

They must not become independent sources of truth in the final architecture.

## 25. Authority Rule

The V2 Reservation Engine becomes the authoritative reservation layer.

Business modules request reservations through the Inventory Engine.

Business modules must not directly modify:

- InventoryBalance.reservedQty
- InventoryBalance.availableQty

without going through the Reservation Engine.

## 26. Reservation History

Reservation history must be retained.

The system must support historical reconstruction of:

- who reserved
- what was reserved
- when it was reserved
- why it was reserved
- where it was reserved
- when it was released
- why it was released
- what was ultimately issued

Historical reservation records must not be physically deleted.

## 27. Future Integration

Reservation Engine will integrate with:

- InventoryBalance
- InventoryMovement
- InventoryLedger
- InventoryBatch
- InventorySerial
- Warehouse
- WarehouseBin
- SalesOrder
- DispatchOrder
- Production
- ProjectOS
- Service
- RMA

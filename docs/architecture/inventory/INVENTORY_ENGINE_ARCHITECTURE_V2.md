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


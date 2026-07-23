export class CreateDispatchOrderDto {

  // ==================================================
  // Source Information
  // ==================================================

  dispatchSource?: string;
  referenceId?: string;

  // ==================================================
  // Sales Order (Optional)
  // ==================================================

  salesOrderId?: string;

  // ==================================================
  // Customer
  // ==================================================

  customerId?: string;
  customerName?: string;

  // ==================================================
  // Commercial
  // ==================================================

  isCommercial?: boolean;
  dispatchReason?: string;

  // ==================================================
  // Logistics
  // ==================================================

  dispatchDate?: string;
  transportName?: string;
  vehicleNumber?: string;
  driverName?: string;
  driverMobile?: string;
  lrNumber?: string;
  destination?: string;
  routeName?: string;
  dispatchMode?: string;
  dispatchPriority?: string;
  expectedDelivery?: string;

  // ==================================================
  // Warehouse
  // ==================================================

  warehouseId?: string;
  preparedBy?: string;
  loadedBy?: string;
  checkedBy?: string;

  // ==================================================
  // Approvals
  // ==================================================

  approvedByAccounts?: string;
  approvedByLogistics?: string;

  // ==================================================
  // Remarks
  // ==================================================

  remarks?: string;
}

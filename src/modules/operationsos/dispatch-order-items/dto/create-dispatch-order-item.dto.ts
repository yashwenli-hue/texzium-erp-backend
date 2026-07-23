export class CreateDispatchOrderItemDto {
  dispatchOrderId: string;

  inventoryItemId?: string;

  productCode?: string;
  productName?: string;

  description?: string;

  quantity: number;

  uom?: string;

  unitPrice?: number;
  discountAmount?: number;
  taxableAmount?: number;
  gstAmount?: number;
  totalAmount?: number;

  warehouseId?: string;
  binLocation?: string;

  serialNumber?: string;
  batchNumber?: string;

  remarks?: string;
}

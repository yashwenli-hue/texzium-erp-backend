export class ReceiveInventoryDto {
  goodsReceiptId: string;

  warehouseId: string;

  warehouseBinId?: string;

  batchId?: string;

  serialId?: string;

  quantity: number;

  unitCost?: number;

  remarks?: string;

  receivedBy?: string;
}

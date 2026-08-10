export class TransferInventoryDto {
  inventoryItemId: string;

  sourceWarehouseId: string;
  sourceBinId?: string;

  destinationWarehouseId: string;
  destinationBinId?: string;

  batchId?: string;
  serialId?: string;

  quantity: number;

  unitCost?: number;

  remarks?: string;

  transferredBy?: string;
}

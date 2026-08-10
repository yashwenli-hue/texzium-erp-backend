export class AdjustmentInventoryDto {
  inventoryItemId: string;

  warehouseId: string;

  warehouseBinId?: string;

  batchId?: string;

  serialId?: string;

  quantity: number;

  unitCost?: number;

  adjustmentType: 'IN' | 'OUT';

  remarks?: string;

  adjustedBy?: string;
}

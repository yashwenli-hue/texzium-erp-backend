export class ReserveInventoryDto {
  inventoryItemId: string;

  dispatchOrderItemId: string;

  quantity: number;

  warehouseId?: string;

  binLocation?: string;

  reservedBy?: string;

  remarks?: string;
}

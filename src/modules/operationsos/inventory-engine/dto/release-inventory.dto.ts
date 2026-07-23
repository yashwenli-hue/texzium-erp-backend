export class ReleaseInventoryDto {
  inventoryItemId: string;

  dispatchOrderItemId: string;

  quantity: number;

  releasedBy?: string;

  remarks?: string;
}

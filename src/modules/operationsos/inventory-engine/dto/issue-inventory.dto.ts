export class IssueInventoryDto {
  inventoryItemId: string;

  dispatchOrderItemId: string;

  warehouseId: string;

  quantity: number;

  issuedBy?: string;

  remarks?: string;
}

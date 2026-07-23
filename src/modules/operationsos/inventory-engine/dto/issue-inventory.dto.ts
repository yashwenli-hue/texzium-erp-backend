export class IssueInventoryDto {
  inventoryItemId: string;

  dispatchOrderItemId: string;

  quantity: number;

  issuedBy?: string;

  remarks?: string;
}

export interface IssueStockInput {
  inventoryItemId: string;

  quantity: number;

  referenceModule: string;

  referenceId: string;

  remarks?: string;

  warehouseId?: string;

  dispatchOrderItemId?: string;

  createdBy?: string;
}

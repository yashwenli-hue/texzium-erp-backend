export class CreateInventoryTransactionDto {
  inventoryItemId: string;

  warehouseId?: string;
  binLocation?: string;

  transactionType: string;

  referenceModule?: string;
  referenceId?: string;

  quantity: number;

  remarks?: string;

  createdBy?: string;
}

export class CreateWarehousePutawayDto {
  qualityInspectionId: string;
  inventoryItemId: string;
  warehouseName: string;
  zoneName?: string;
  rackNumber: string;
  binNumber: string;
  putawayQty: number;
}

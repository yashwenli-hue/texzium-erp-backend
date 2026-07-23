export class CreateQualityInspectionDto {
  goodsReceiptId: string;
  acceptedQty: number;
  rejectedQty: number;
  remarks?: string;
  inspectorName?: string;
}

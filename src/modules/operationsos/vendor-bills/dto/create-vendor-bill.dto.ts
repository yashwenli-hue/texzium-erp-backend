export class CreateVendorBillDto {
  goodsReceiptId: string;
  vendorName: string;
  billDate: string;
  taxableAmount: number;
  taxAmount: number;
  totalAmount: number;
  remarks?: string;
}

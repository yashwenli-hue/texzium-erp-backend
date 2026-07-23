export class CreateSalesOrderAdvanceReceiptDto {
  salesOrderId: string;
  receiptDate: Date;
  amountReceived: number;
  paymentMode: string;
  referenceNo?: string;
  remarks?: string;
}

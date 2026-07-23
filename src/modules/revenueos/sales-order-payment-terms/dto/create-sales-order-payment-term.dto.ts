export class CreateSalesOrderPaymentTermDto {
  salesOrderId: string;
  paymentType: string;
  advanceAmount: number;
  balanceAmount: number;
  creditDays?: number;
  dueDate?: Date;
  remarks?: string;
}

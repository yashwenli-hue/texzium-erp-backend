import { IsUUID } from 'class-validator';

// GET /receipt-vouchers?salesInvoiceId=...
export class ListReceiptVouchersQueryDto {
  @IsUUID()
  salesInvoiceId: string;
}

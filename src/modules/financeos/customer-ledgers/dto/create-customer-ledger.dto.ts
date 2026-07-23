export class CreateCustomerLedgerDto {
  customerName: string;
  salesInvoiceId: string;
  debitAmount?: number;
  creditAmount?: number;
  balanceAmount: number;
  entryDate: string;
  remarks?: string;
}

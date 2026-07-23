export class CreateVendorLedgerDto {
  vendorName: string;
  vendorBillId: string;
  debitAmount?: number;
  creditAmount?: number;
  balanceAmount: number;
  entryDate: string;
  remarks?: string;
}

export class CreateJournalDto {
  voucherDate: string;
  narration?: string;
  financialYearId: string;

  lines: {
    accountId: string;
    debitAmount: number;
    creditAmount: number;
    remarks?: string;
  }[];
}

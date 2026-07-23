export class CreateChartOfAccountDto {
  accountCode: string;
  accountName: string;
  accountType: string;
  accountGroupId: string;
  openingBalance?: number;
}

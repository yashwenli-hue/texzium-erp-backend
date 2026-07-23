export class CreateCompanyDto {
  companyCode: string;
  companyName: string;
  panNumber: string;
  cinNumber?: string;
  msmeNumber?: string;
  companyType?: string;
  email?: string;
  phone?: string;
  website?: string;
}

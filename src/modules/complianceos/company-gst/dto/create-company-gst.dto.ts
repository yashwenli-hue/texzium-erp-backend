export class CreateCompanyGstDto {
  companyId: string;
  gstin: string;
  legalName: string;
  tradeName?: string;
  branchName?: string;
  stateCode: string;
  stateName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  pincode: string;
  registrationType: string;
  isDefault?: boolean;
}

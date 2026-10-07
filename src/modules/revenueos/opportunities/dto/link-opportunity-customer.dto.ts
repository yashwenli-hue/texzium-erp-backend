import { IsUUID, ValidateIf } from 'class-validator';

// PATCH /opportunities/:id/customer
//
// `customerId` is required: a customer id links (or changes) the customer, and
// null unlinks it. Leaving it out is an error, not an unlink.
export class LinkOpportunityCustomerDto {
  @ValidateIf((o: LinkOpportunityCustomerDto) => o.customerId !== null)
  @IsUUID()
  customerId: string | null;
}

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { conflict } from '../customer-master/customer-lifecycle';

// The customer an opportunity is for.
//
// "Opportunity"."customerId" is set only on purpose: when the opportunity is
// created with a customer, or by the link action. Nothing back-fills it. While
// it is empty the opportunity is a legacy one and the documents under it behave
// as they always did.
//
// A legacy opportunity that already has documents can be given its customer
// (that is how an existing deal joins the customer), as long as none of those
// documents uses a GST registration of another customer. Once it has a customer
// and a quotation, the customer can no longer be changed or removed: every
// document under the opportunity takes its customer from here. The link action
// and quotation creation take the opportunity row (the first exclusively, the
// second in shared mode) so they cannot both succeed.
export const OPPORTUNITY_NOT_FOUND_MESSAGE = 'Opportunity not found.';

export const OPPORTUNITY_CUSTOMER_CONFLICT_CODE = {
  OPPORTUNITY_NOT_LINKED: 'OPPORTUNITY_NOT_LINKED',
  OPPORTUNITY_CUSTOMER_LOCKED: 'OPPORTUNITY_CUSTOMER_LOCKED',
  OPPORTUNITY_CUSTOMER_CHANGED: 'OPPORTUNITY_CUSTOMER_CHANGED',
  OPPORTUNITY_GST_OF_ANOTHER_CUSTOMER: 'OPPORTUNITY_GST_OF_ANOTHER_CUSTOMER',
} as const;

export const OPPORTUNITY_CUSTOMER_ACTION = {
  LINKED: 'OPPORTUNITY_CUSTOMER_LINKED',
  CHANGED: 'OPPORTUNITY_CUSTOMER_CHANGED',
  UNLINKED: 'OPPORTUNITY_CUSTOMER_UNLINKED',
} as const;

type Tx = Prisma.TransactionClient;

// Only these fields of the customer leave the API with an opportunity.
export const OPPORTUNITY_CUSTOMER_SELECT = {
  id: true,
  customerCode: true,
  customerName: true,
  isActive: true,
} satisfies Prisma.CustomerSelect;

// Locks the opportunity row exclusively and returns its customer. Used by the
// link action.
export async function lockOpportunityForLink(
  tx: Tx,
  opportunityId: string,
): Promise<{ customerId: string | null }> {
  const rows = await tx.$queryRaw<Array<{ customerId: string | null }>>`
    /* opportunity:lock-link */
    SELECT "customerId"
    FROM "Opportunity"
    WHERE "id" = ${opportunityId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    throw new NotFoundException(OPPORTUNITY_NOT_FOUND_MESSAGE);
  }

  return rows[0];
}

// Locks the opportunity row in shared mode and returns its customer: the
// customer cannot be linked, changed or unlinked until the transaction ends.
// Used by quotation creation.
export async function lockOpportunityShared(
  tx: Tx,
  opportunityId: string,
): Promise<{ customerId: string | null }> {
  const rows = await tx.$queryRaw<Array<{ customerId: string | null }>>`
    /* opportunity:lock-shared */
    SELECT "customerId"
    FROM "Opportunity"
    WHERE "id" = ${opportunityId}
    FOR SHARE
  `;

  if (rows.length === 0) {
    throw new NotFoundException(OPPORTUNITY_NOT_FOUND_MESSAGE);
  }

  return rows[0];
}

export function conflictOpportunityNotLinked(): ConflictException {
  return conflict(
    'This opportunity has no customer yet. Link a customer to it before creating a quotation.',
    OPPORTUNITY_CUSTOMER_CONFLICT_CODE.OPPORTUNITY_NOT_LINKED,
  );
}

export function conflictOpportunityCustomerLocked(): ConflictException {
  return conflict(
    'This opportunity already has a customer and a quotation, so its customer can no longer be changed or removed.',
    OPPORTUNITY_CUSTOMER_CONFLICT_CODE.OPPORTUNITY_CUSTOMER_LOCKED,
  );
}

export function conflictOpportunityGstOfAnotherCustomer(): ConflictException {
  return conflict(
    'This opportunity already has documents that use a GST registration of another customer, so it cannot be linked to this one.',
    OPPORTUNITY_CUSTOMER_CONFLICT_CODE.OPPORTUNITY_GST_OF_ANOTHER_CUSTOMER,
  );
}

// Does anything already under the opportunity (a quotation, or an order made
// from one) use a buyer GST registration that is not `customerId`'s? Legacy
// quotations may have none, which is fine.
export async function usesRegistrationOfAnotherCustomer(
  tx: Tx,
  opportunityId: string,
  customerId: string,
): Promise<boolean> {
  const quotations = await tx.quotation.findMany({
    where: { opportunityId },
    select: { id: true, buyerGstId: true },
  });

  if (quotations.length === 0) return false;

  const quotationIds = quotations.map((q) => q.id);

  const proformas = await tx.proformaInvoice.findMany({
    where: { quotationId: { in: quotationIds } },
    select: { id: true },
  });

  const orders = await tx.salesOrder.findMany({
    where: {
      OR: [
        { quotationId: { in: quotationIds } },
        { proformaInvoiceId: { in: proformas.map((p) => p.id) } },
      ],
    },
    select: { buyerGstId: true },
  });

  const registrationIds = [
    ...quotations.map((q) => q.buyerGstId),
    ...orders.map((o) => o.buyerGstId),
  ].filter((id): id is string => !!id);

  if (registrationIds.length === 0) return false;

  const foreign = await tx.customerGSTRegistration.count({
    where: { id: { in: registrationIds }, customerId: { not: customerId } },
  });

  return foreign > 0;
}

export function conflictOpportunityCustomerChanged(): ConflictException {
  return conflict(
    "This opportunity's customer changed while you were working. Reload and try again.",
    OPPORTUNITY_CUSTOMER_CONFLICT_CODE.OPPORTUNITY_CUSTOMER_CHANGED,
  );
}

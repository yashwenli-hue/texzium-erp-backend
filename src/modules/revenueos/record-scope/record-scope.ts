import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Who may see which RevenueOS records: the one place the rule is written.
//
// A person holding `revenue.view.all` sees every lead, opportunity, customer and sales
// document (administrators; the migration grants it to SUPER_ADMIN only, so nothing
// changes for today's users). Everyone else sees only what they work on, derived from
// the records that already exist (no new ownership data):
//
//   a lead          they are its current assignee, or they appear in its history (they
//                   created it, were assigned it, acted on it, or completed one of its
//                   follow-ups); pre-sales people therefore keep sight of the leads
//                   they handed to sales
//   an opportunity  its lead is visible
//   a customer      one of its opportunities is visible, or they created or changed it
//                   (it appears in its history with them as the actor)
//   a quotation     its opportunity is visible; a Proforma Invoice, its quotation; a
//                   sales order, its Proforma or quotation; an invoice, its sales order;
//                   a receivable / payment, its invoice
//
// A record outside the scope is answered as "not found" (404), never 403, so its
// existence does not leak; lists, counts and searches only ever contain records in it.
//
// The rule follows the existing assignment model. Teams, managers or explicit customer
// owners do not exist in the data; adding them is a business decision (see the handover).

export const VIEW_ALL_PERMISSION = 'revenue.view.all';

export type RecordScope = { all: true } | { all: false; userId: string };

/** No restriction: for internal callers (and the default of every scoped list). */
export const ALL_RECORDS: RecordScope = { all: true };

export type ScopedUser = { id?: string; permissions?: unknown } | undefined;

export function scopeOf(user: ScopedUser): RecordScope {
  if (!user?.id)
    throw new UnauthorizedException('Authenticated user required.');
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  return perms.includes(VIEW_ALL_PERMISSION)
    ? { all: true }
    : { all: false, userId: user.id };
}

/** `undefined` means "no restriction" (merge with `and`). */
type W<T> = T | undefined;

export function leadWhere(scope: RecordScope): W<Prisma.LeadWhereInput> {
  if (scope.all) return undefined;
  const u = scope.userId;
  return {
    OR: [
      { assignedToId: u },
      { timelines: { some: { OR: [{ actorId: u }, { subjectUserId: u }] } } },
      { followups: { some: { completedById: u } } },
    ],
  };
}

export function opportunityWhere(
  scope: RecordScope,
): W<Prisma.OpportunityWhereInput> {
  const lead = leadWhere(scope);
  return lead ? { lead } : undefined;
}

export function customerWhere(
  scope: RecordScope,
): W<Prisma.CustomerWhereInput> {
  if (scope.all) return undefined;
  return {
    OR: [
      { opportunities: { some: opportunityWhere(scope)! } },
      { events: { some: { actorId: scope.userId } } },
    ],
  };
}

export function quotationWhere(
  scope: RecordScope,
): W<Prisma.QuotationWhereInput> {
  const opportunity = opportunityWhere(scope);
  return opportunity ? { opportunity } : undefined;
}

export function proformaWhere(
  scope: RecordScope,
): W<Prisma.ProformaInvoiceWhereInput> {
  const quotation = quotationWhere(scope);
  return quotation ? { quotation } : undefined;
}

export function salesOrderWhere(
  scope: RecordScope,
): W<Prisma.SalesOrderWhereInput> {
  if (scope.all) return undefined;
  return {
    OR: [
      { proformaInvoice: proformaWhere(scope)! },
      { Quotation: quotationWhere(scope)! },
    ],
  };
}

export function salesInvoiceWhere(
  scope: RecordScope,
): W<Prisma.SalesInvoiceWhereInput> {
  const salesOrder = salesOrderWhere(scope);
  return salesOrder ? { salesOrder } : undefined;
}

export function receivableWhere(
  scope: RecordScope,
): W<Prisma.AccountsReceivableWhereInput> {
  const salesInvoice = salesInvoiceWhere(scope);
  return salesInvoice ? { salesInvoice } : undefined;
}

export function paymentCollectionWhere(
  scope: RecordScope,
): W<Prisma.PaymentCollectionWhereInput> {
  const accountsReceivable = receivableWhere(scope);
  return accountsReceivable ? { accountsReceivable } : undefined;
}

export function gstRegistrationWhere(
  scope: RecordScope,
): W<Prisma.CustomerGSTRegistrationWhereInput> {
  const customer = customerWhere(scope);
  return customer ? { customer } : undefined;
}

export function followupWhere(
  scope: RecordScope,
): W<Prisma.LeadFollowupWhereInput> {
  const lead = leadWhere(scope);
  return lead ? { lead } : undefined;
}

/** For lists of rows that belong to a sales order (payment terms, receipts, approvals). */
export function salesOrderChildWhere(
  scope: RecordScope,
): W<{ salesOrder: Prisma.SalesOrderWhereInput }> {
  const salesOrder = salesOrderWhere(scope);
  return salesOrder ? { salesOrder } : undefined;
}

/** `where` AND the scope (the scope may be "no restriction"). */
export function and<T extends object>(
  where: T | undefined,
  scoped: T | undefined,
): T | undefined {
  if (!scoped) return where;
  if (!where || Object.keys(where).length === 0) return scoped;
  return { AND: [where, scoped] } as unknown as T;
}

/**
 * The same lead rule as SQL, for raw queries (lead search). `alias` is the Lead table's
 * alias in the query. TRUE when unrestricted.
 */
export function leadVisibleSql(scope: RecordScope, alias: string): Prisma.Sql {
  if (scope.all) return Prisma.sql`TRUE`;
  const u = scope.userId;
  const a = Prisma.raw(`"${alias}"`);
  return Prisma.sql`(
    ${a}."assignedToId" = ${u}
    OR EXISTS (SELECT 1 FROM "LeadTimeline" vt WHERE vt."leadId" = ${a}."id" AND (vt."actorId" = ${u} OR vt."subjectUserId" = ${u}))
    OR EXISTS (SELECT 1 FROM "LeadFollowup" vf WHERE vf."leadId" = ${a}."id" AND vf."completedById" = ${u})
  )`;
}

export const NOT_FOUND_MESSAGE: Record<ScopedKind, string> = {
  lead: 'Lead not found.',
  opportunity: 'Opportunity not found.',
  customer: 'Customer not found.',
  gstRegistration: 'GST registration not found.',
  quotation: 'Quotation not found.',
  proforma: 'Proforma Invoice not found.',
  salesOrder: 'Sales order not found.',
  salesInvoice: 'Sales invoice not found.',
  paymentCollection: 'Payment not found.',
  followup: 'Follow-up not found.',
  advanceReceipt: 'Advance receipt not found.',
  commercialApproval: 'Commercial approval not found.',
};

export type ScopedKind =
  | 'lead'
  | 'opportunity'
  | 'customer'
  | 'gstRegistration'
  | 'quotation'
  | 'proforma'
  | 'salesOrder'
  | 'salesInvoice'
  | 'paymentCollection'
  | 'followup'
  | 'advanceReceipt'
  | 'commercialApproval';

type CountDb = {
  [K in
    | 'lead'
    | 'opportunity'
    | 'customer'
    | 'customerGSTRegistration'
    | 'quotation'
    | 'proformaInvoice'
    | 'salesOrder'
    | 'salesInvoice'
    | 'paymentCollection'
    | 'leadFollowup'
    | 'salesOrderAdvanceReceipt'
    | 'accountsCommercialApproval']: {
    count: (args: { where: object }) => Promise<number>;
  };
};

/** Is this record inside the scope? (An id that does not exist is not.) */
export async function isVisible(
  db: CountDb,
  scope: RecordScope,
  kind: ScopedKind,
  id: string,
): Promise<boolean> {
  if (scope.all) return true;
  const by = (where: object | undefined) => ({
    where: { AND: [{ id }, where ?? {}] },
  });
  switch (kind) {
    case 'lead':
      return (await db.lead.count(by(leadWhere(scope)))) > 0;
    case 'opportunity':
      return (await db.opportunity.count(by(opportunityWhere(scope)))) > 0;
    case 'customer':
      return (await db.customer.count(by(customerWhere(scope)))) > 0;
    case 'gstRegistration':
      return (
        (await db.customerGSTRegistration.count(
          by(gstRegistrationWhere(scope)),
        )) > 0
      );
    case 'quotation':
      return (await db.quotation.count(by(quotationWhere(scope)))) > 0;
    case 'proforma':
      return (await db.proformaInvoice.count(by(proformaWhere(scope)))) > 0;
    case 'salesOrder':
      return (await db.salesOrder.count(by(salesOrderWhere(scope)))) > 0;
    case 'salesInvoice':
      return (await db.salesInvoice.count(by(salesInvoiceWhere(scope)))) > 0;
    case 'paymentCollection':
      return (
        (await db.paymentCollection.count(by(paymentCollectionWhere(scope)))) >
        0
      );
    case 'followup':
      return (await db.leadFollowup.count(by(followupWhere(scope)))) > 0;
    case 'advanceReceipt':
      return (
        (await db.salesOrderAdvanceReceipt.count(
          by(salesOrderChildWhere(scope)),
        )) > 0
      );
    case 'commercialApproval':
      return (
        (await db.accountsCommercialApproval.count(
          by(salesOrderChildWhere(scope)),
        )) > 0
      );
  }
}

export async function assertVisible(
  db: CountDb,
  scope: RecordScope,
  kind: ScopedKind,
  id: string,
): Promise<void> {
  if (!(await isVisible(db, scope, kind, id)))
    throw new NotFoundException(NOT_FOUND_MESSAGE[kind]);
}

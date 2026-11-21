// Where a quotation has got to, in words Pre-Sales can follow without seeing a
// price: from being prepared to an order placed. Worked out from the quotation's
// status and the Proforma and Sales Order made from it.

export type QuotationProgress =
  | 'IN_PREPARATION' // DRAFT or REVISED: Sales is still working on it
  | 'APPROVED' // approved, ready for the customer
  | 'PROFORMA_ISSUED' // a Proforma Invoice was issued to the customer
  | 'CUSTOMER_ACCEPTED' // the customer approved the Proforma
  | 'ORDER_PLACED' // a Sales Order was placed (and not cancelled)
  | 'REJECTED';

export const QUOTATION_PROGRESS_LABEL: Record<QuotationProgress, string> = {
  IN_PREPARATION: 'Being prepared',
  APPROVED: 'Approved, ready for the customer',
  PROFORMA_ISSUED: 'Proforma issued to the customer',
  CUSTOMER_ACCEPTED: 'Customer accepted',
  ORDER_PLACED: 'Order placed',
  REJECTED: 'Rejected',
};

export function quotationProgress(input: {
  status: string;
  /** customerStatus of each Proforma made from the quotation. */
  proformaStatuses: string[];
  /** status of each Sales Order made from it (through a Proforma or directly). */
  orderStatuses: string[];
}): QuotationProgress {
  if (input.status === 'REJECTED') return 'REJECTED';
  if (input.orderStatuses.some((s) => s !== 'CANCELLED')) return 'ORDER_PLACED';
  if (input.proformaStatuses.includes('APPROVED')) return 'CUSTOMER_ACCEPTED';
  if (input.proformaStatuses.some((s) => s !== 'CANCELLED'))
    return 'PROFORMA_ISSUED';
  if (input.status === 'APPROVED') return 'APPROVED';
  return 'IN_PREPARATION';
}

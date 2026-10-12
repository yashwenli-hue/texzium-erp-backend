import { roundMoney } from '../quotations/quotation-lifecycle';

// How a document's GST is levied: CGST + SGST for a supply within the seller's
// state (the buyer's registration is in the same state), IGST for a supply to
// another state. Set on a quotation when it is created and carried into its
// Proforma, Sales Order and invoice.
export const TAX_TYPE = {
  CGST_SGST: 'CGST_SGST',
  IGST: 'IGST',
} as const;

export type TaxType = (typeof TAX_TYPE)[keyof typeof TAX_TYPE];

export function isKnownTaxType(value: unknown): value is TaxType {
  return value === TAX_TYPE.CGST_SGST || value === TAX_TYPE.IGST;
}

export type GstSplit = {
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
};

// Splits a GST amount (already rounded to the paisa) by tax type. CGST and SGST
// are each half; when the amount has an odd paisa, CGST gets the half rounded to
// the paisa and SGST the rest, so the two always add up to the GST exactly.
export function splitGst(gstAmount: number, taxType: string): GstSplit {
  const gst = roundMoney(gstAmount);
  if (taxType === TAX_TYPE.IGST) {
    return { cgstAmount: 0, sgstAmount: 0, igstAmount: gst };
  }
  if (taxType === TAX_TYPE.CGST_SGST) {
    const cgst = roundMoney(gst / 2);
    return {
      cgstAmount: cgst,
      sgstAmount: roundMoney(gst - cgst),
      igstAmount: 0,
    };
  }
  throw new Error(`Unknown tax type: ${taxType}`);
}

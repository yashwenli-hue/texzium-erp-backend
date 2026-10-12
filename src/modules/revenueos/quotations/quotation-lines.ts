import { splitGst } from '../tax/gst-split';
import { computeQuotationAmounts } from './quotation-lifecycle';

// The values of one priced line, worked out by the backend: taxable = quantity x
// unit rate (to the paisa), GST at the line's rate, split by the tax type, and
// the total. The client supplies only the item, the quantity and the unit rate.
export type QuotationLineValues = {
  lineNumber: number;
  inventoryItemId: string | null;
  description: string;
  hsnCode: string | null;
  quantity: number;
  unitRate: number;
  taxableAmount: number;
  gstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  gstAmount: number;
  totalAmount: number;
};

export function buildQuotationLine(input: {
  lineNumber: number;
  inventoryItemId: string | null;
  description: string;
  hsnCode: string | null;
  quantity: number;
  unitRate: number;
  gstRate: number;
  taxType: string;
}): QuotationLineValues {
  const amounts = computeQuotationAmounts(
    input.quantity * input.unitRate,
    input.gstRate,
  );
  return {
    lineNumber: input.lineNumber,
    inventoryItemId: input.inventoryItemId,
    description: input.description,
    hsnCode: input.hsnCode,
    quantity: input.quantity,
    unitRate: input.unitRate,
    gstRate: input.gstRate,
    ...amounts,
    ...splitGst(amounts.gstAmount, input.taxType),
  };
}

// The amounts a line carries into a Proforma Invoice line (or an invoice line):
// copied as stored, never worked out again.
export function copyLineValues(line: QuotationLineValues): QuotationLineValues {
  return {
    lineNumber: line.lineNumber,
    inventoryItemId: line.inventoryItemId,
    description: line.description,
    hsnCode: line.hsnCode,
    quantity: line.quantity,
    unitRate: line.unitRate,
    taxableAmount: line.taxableAmount,
    gstRate: line.gstRate,
    cgstAmount: line.cgstAmount,
    sgstAmount: line.sgstAmount,
    igstAmount: line.igstAmount,
    gstAmount: line.gstAmount,
    totalAmount: line.totalAmount,
  };
}

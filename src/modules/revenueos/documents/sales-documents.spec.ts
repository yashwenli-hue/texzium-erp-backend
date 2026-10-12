import { renderDocumentPdf } from '../../../core/documents/document-renderer';
import {
  collapse,
  pdfPageTexts,
} from '../../../core/documents/pdf-text.helper-spec';
import { PERMISSIONS_KEY } from '../../../core/decorators/permissions.decorator';
import type { DocumentIssuer } from '../../adminos/document-profile/document-identity';
import { quotationDocument } from '../quotations/quotation-document';
import { QuotationsController } from '../quotations/quotations.controller';
import { proformaDocument } from '../proforma-invoices/proforma-document';
import { ProformaInvoicesController } from '../proforma-invoices/proforma-invoices.controller';
import {
  invoiceDocument,
  invoiceDocumentBlockers,
  InvoiceDocumentData,
} from '../sales-invoices/invoice-document';
import { SalesInvoicesController } from '../sales-invoices/sales-invoices.controller';
import { receiptDocument } from '../../financeos/receipt-vouchers/receipt-document';
import { ReceiptVouchersController } from '../../financeos/receipt-vouchers/receipt-vouchers.controller';
import type { PricedLine, RegistrationLike } from './revenue-document-parts';

const issuer: DocumentIssuer = {
  identity: {
    legalName: 'Texzium Industries Private Limited',
    tradeName: 'Texzium',
    addressLines: ['Plot 7, GIDC', 'Ahmedabad 382445'],
    details: [
      'GSTIN 24AAACT1234A1Z5 · Gujarat (24)',
      'PAN AAACT1234A · CIN U12345GJ2020PTC123456',
    ],
  },
  legalName: 'Texzium Industries Private Limited',
  registration: {
    gstin: '24AAACT1234A1Z5',
    stateCode: '24',
    stateName: 'Gujarat',
  },
  bankLines: [
    'Texzium Industries Pvt Ltd · HDFC Bank',
    'A/c 50200012345678 · IFSC HDFC0000123',
  ],
  terms: {
    quotation: ['Prices are ex-works.'],
    proforma: ['Advance of 50% with the order.'],
    invoice: ['Payment within 30 days.'],
    receipt: ['Thank you for your payment.'],
  },
  signatory: { name: 'A. Mehta', designation: 'Director' },
};

const buyer: RegistrationLike = {
  gstin: '27AAAPL1234C1ZV',
  legalName: 'Raj Traders Private Limited',
  tradeName: null,
  addressLine1: '12 MG Road',
  addressLine2: null,
  city: 'Pune',
  pincode: '411001',
  stateCode: '27',
  stateName: 'Maharashtra',
};
const customer = { customerName: 'राज Traders', customerCode: 'CUST001' };

const line: PricedLine = {
  lineNumber: 1,
  description: 'Industrial pump',
  hsnCode: '84137090',
  quantity: 3,
  unitRate: 33333.33,
  taxableAmount: 99999.99,
  gstRate: 18,
  cgstAmount: 0,
  sgstAmount: 0,
  igstAmount: 18000,
  gstAmount: 18000,
  totalAmount: 117999.99,
};
const at = new Date('2026-10-12T06:00:00Z');

const text = async (spec: Parameters<typeof renderDocumentPdf>[0]) =>
  collapse(
    pdfPageTexts(await renderDocumentPdf(spec, { compress: false })).join(' '),
  );

describe('sales document routes', () => {
  it('each document route needs the permission that reads its record', () => {
    const perm = (proto: object, m: string) =>
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        (proto as Record<string, unknown>)[m] as object,
      ) as string[];
    expect(perm(QuotationsController.prototype, 'document')).toEqual([
      'quotations.view',
    ]);
    expect(perm(ProformaInvoicesController.prototype, 'document')).toEqual([
      'proformas.view',
    ]);
    // the tax invoice also needs invoices.document.view, granted to nobody yet
    expect(perm(SalesInvoicesController.prototype, 'document')).toEqual([
      'invoices.view',
      'invoices.document.view',
    ]);
    expect(perm(ReceiptVouchersController.prototype, 'document')).toEqual([
      'collections.view',
    ]);
  });
});

describe('quotation document', () => {
  const data = (
    over: Partial<Parameters<typeof quotationDocument>[0]['quotation']> = {},
  ) => ({
    quotation: {
      id: 'q1',
      quotationCode: 'QT24/26-27/00001',
      quoteDate: new Date('2026-10-12T00:00:00Z'),
      status: 'APPROVED',
      taxType: 'IGST',
      placeOfSupply: 'Maharashtra',
      taxableAmount: 99999.99,
      gstPercent: 18,
      gstAmount: 18000,
      totalAmount: 117999.99,
      ...over,
    },
    lines: [line],
    customer,
    buyer,
    issuer,
    generatedAt: at,
  });

  it('prints the quotation, its line and its stored amounts', async () => {
    const t = await text(quotationDocument(data()));
    for (const s of [
      'Quotation',
      'Quotation no. QT24/26-27/00001',
      'Date 12 Oct 2026',
      'Place of supply Maharashtra (27)',
      'QUOTATION FOR',
      'राज Traders',
      'Raj Traders Private Limited',
      'GSTIN 27AAAPL1234C1ZV · Maharashtra (27)',
      '1 Industrial pump 84137090 3 33,333.33 99,999.99 18% 18,000.00 1,17,999.99',
      'Taxable value ₹99,999.99',
      'IGST 18% ₹18,000.00',
      'Total ₹1,17,999.99',
      'Indian Rupees One Lakh Seventeen Thousand Nine Hundred Ninety-Nine and Ninety-Nine Paise Only',
      'Prices are ex-works.',
      'For Texzium Industries Private Limited',
    ])
      expect(t).toContain(s);
    expect(t).not.toContain('DRAFT');
  });

  it('a draft is watermarked; a legacy quotation says what was not recorded', async () => {
    const draft = await text(quotationDocument(data({ status: 'DRAFT' })));
    expect(draft).toContain('DRAFT');
    const legacy = await text(
      quotationDocument({
        ...data({
          quotationCode: null,
          taxableAmount: 0,
          gstPercent: 0,
          gstAmount: 0,
          totalAmount: 275000,
        }),
        lines: [],
      }),
    );
    expect(legacy).toContain('Quotation no. Not numbered');
    expect(legacy).toContain('its item, quantity and rate are not available');
    expect(legacy).toContain(
      'The tax breakdown of this quotation was not recorded',
    );
    expect(legacy).toContain('Total ₹2,75,000.00');
    expect(legacy).not.toContain('Taxable value ₹');
  });

  it('CGST and SGST come from the stored line split', async () => {
    const t = await text(
      quotationDocument({
        ...data({ taxType: 'CGST_SGST' }),
        lines: [{ ...line, igstAmount: 0, cgstAmount: 9000, sgstAmount: 9000 }],
      }),
    );
    expect(t).toContain('CGST ₹9,000.00');
    expect(t).toContain('SGST ₹9,000.00');
  });
});

describe('Proforma Invoice document', () => {
  const data = (
    over: Partial<Parameters<typeof proformaDocument>[0]['proforma']> = {},
  ) => ({
    proforma: {
      id: 'p1',
      proformaNumber: 'PI24/26-27/00001',
      issueDate: new Date('2026-10-12T00:00:00Z'),
      validityDate: new Date('2026-11-11T00:00:00Z'),
      customerStatus: 'PENDING',
      totalAmount: 117999.99,
      remarks: 'Advance requested',
      isExpired: false,
      ...over,
    },
    quotation: {
      quotationCode: 'QT24/26-27/00001',
      taxType: 'IGST',
      placeOfSupply: 'Maharashtra',
      taxableAmount: 99999.99,
      gstPercent: 18,
      gstAmount: 18000,
      totalAmount: 117999.99,
    },
    lines: [line],
    customer,
    buyer,
    issuer,
    generatedAt: at,
  });

  it('is clearly not a tax invoice, and prints its lines, totals and bank details', async () => {
    const t = await text(proformaDocument(data()));
    for (const s of [
      'Proforma Invoice',
      'Not a tax invoice',
      'It is not a tax invoice',
      'Proforma no. PI24/26-27/00001',
      'Valid until 11 Nov 2026',
      'Quotation no. QT24/26-27/00001',
      'Total ₹1,17,999.99',
      'A/c 50200012345678 · IFSC HDFC0000123',
      'Advance requested',
      'Advance of 50% with the order.',
    ])
      expect(t).toContain(s);
    expect(t).not.toMatch(/Tax Invoice/);
  });

  it('a cancelled one is watermarked; an expired one says so', async () => {
    expect(
      await text(proformaDocument(data({ customerStatus: 'CANCELLED' }))),
    ).toContain('CANCELLED');
    expect(await text(proformaDocument(data({ isExpired: true })))).toContain(
      'The validity date of this Proforma Invoice has passed.',
    );
  });
});

describe('tax invoice document', () => {
  const data = (
    over: Partial<InvoiceDocumentData> = {},
  ): InvoiceDocumentData => ({
    invoice: {
      id: 'i1',
      invoiceNumber: 'SI24/26-27/00001',
      invoiceDate: new Date('2026-10-12T00:00:00Z'),
      status: 'POSTED',
      taxableAmount: 99999.99,
      gstAmount: 18000,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 18000,
      totalAmount: 117999.99,
      remarks: null,
      // stored but simulated: never printed
      ...({
        irnNumber: 'IRN-FAKE123',
        ewayBillNumber: 'EWB-FAKE456',
      } as object),
    },
    items: [line],
    order: {
      salesOrderCode: null,
      proformaNumber: 'PI24/26-27/00001',
      quotationCode: 'QT24/26-27/00001',
      taxType: 'IGST',
      placeOfSupply: 'Maharashtra',
    },
    customer,
    buyer,
    issuer,
    generatedAt: at,
    ...over,
  });

  it('prints what GST Rule 46 asks for from the stored invoice, and never an IRN or e-way bill', async () => {
    const t = await text(invoiceDocument(data()));
    for (const s of [
      'Tax Invoice',
      'Original for recipient',
      'GSTIN 24AAACT1234A1Z5 · Gujarat (24)',
      'Invoice no. SI24/26-27/00001',
      'Invoice date 12 Oct 2026',
      'Place of supply Maharashtra (27)',
      'Reverse charge No',
      'BILL TO',
      'GSTIN 27AAAPL1234C1ZV · Maharashtra (27)',
      '1 Industrial pump 84137090 3 33,333.33 99,999.99 18% 18,000.00 1,17,999.99',
      'Taxable value ₹99,999.99',
      'IGST 18% ₹18,000.00',
      'Total ₹1,17,999.99',
      'Tax by line',
      'Payment within 30 days.',
      'Authorised Signatory · Director',
    ])
      expect(t).toContain(s);
    expect(t).not.toMatch(/IRN|FAKE|e-way|EWB/i);
  });

  it('is refused for an invoice that lacks what a tax invoice must carry', () => {
    expect(invoiceDocumentBlockers(data())).toEqual([]);
    expect(
      invoiceDocumentBlockers(
        data({
          invoice: { ...data().invoice, invoiceNumber: null, status: 'DRAFT' },
          items: [{ ...line, hsnCode: null, description: null, gstRate: null }],
          buyer: null,
          order: null,
          issuer: { ...issuer, registration: null },
        }),
      ),
    ).toEqual([
      'it was issued before invoices were numbered',
      'it is not posted',
      'it has no seller GST registration',
      'it has no customer with a buyer GST registration',
      'its lines do not carry a description, HSN and GST rate',
      'its tax type is not recorded',
    ]);
  });
});

describe('payment receipt document', () => {
  const data = (over: Partial<Parameters<typeof receiptDocument>[0]> = {}) => ({
    receipt: {
      id: 'r1',
      receiptNumber: 'RC/26-27/00001',
      receiptDate: new Date('2026-10-10T00:00:00Z'),
      amountReceived: 123456,
      paymentMode: 'BANK_TRANSFER',
      referenceNo: 'TEST123#',
    },
    invoice: {
      invoiceNumber: null,
      invoiceDate: new Date('2026-06-30T00:00:00Z'),
      totalAmount: 295000,
      customerName: 'Raj Traders',
    },
    event: { balanceBefore: 295000, balanceAfter: 171544 },
    customer,
    buyer,
    issuer,
    generatedAt: at,
    ...over,
  });

  it('prints the payment, the invoice and the recorded balances before and after', async () => {
    const t = await text(receiptDocument(data()));
    for (const s of [
      'Payment Receipt',
      'Receipt no. RC/26-27/00001',
      'Receipt date 10 Oct 2026',
      'Payment mode Bank transfer',
      'Reference TEST123#',
      'RECEIVED FROM',
      'Not numbered 30 Jun 2026 2,95,000.00 2,95,000.00 1,23,456.00 1,71,544.00',
      'Amount received ₹1,23,456.00',
      'Indian Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six Only',
      'not a GST receipt voucher',
    ])
      expect(t).toContain(s);
  });

  it('a payment taken before balances were kept shows none, and says so', async () => {
    const t = await text(receiptDocument(data({ event: null })));
    expect(t).toContain('was not recorded');
    expect(t).toContain('— 1,23,456.00 —');
  });
});

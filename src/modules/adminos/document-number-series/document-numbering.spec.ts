import { ConflictException } from '@nestjs/common';

import {
  DOCUMENT_NUMBER_MAX_LENGTH,
  DOCUMENT_NUMBER_TYPE,
  DocumentNumberScope,
  DocumentNumberType,
  allocateDocumentNumber,
  documentNumberPrefix,
  formatDocumentNumber,
} from './document-numbering';

const GUJARAT: DocumentNumberScope = {
  kind: 'registration',
  gstRegistrationId: 'gst-24',
  stateCode: '24',
};
const COMPANY: DocumentNumberScope = { kind: 'company' };
const TYPES = Object.values(DOCUMENT_NUMBER_TYPE) as DocumentNumberType[];

describe('document numbers', () => {
  it('formats "<code><state>/<FY>/<5-digit sequence>"', () => {
    expect(formatDocumentNumber('SALES_INVOICE', GUJARAT, '26-27', 1)).toBe(
      'SI24/26-27/00001',
    );
    expect(formatDocumentNumber('QUOTATION', GUJARAT, '26-27', 42)).toBe(
      'QT24/26-27/00042',
    );
    expect(formatDocumentNumber('PROFORMA_INVOICE', GUJARAT, '26-27', 7)).toBe(
      'PI24/26-27/00007',
    );
    expect(formatDocumentNumber('PAYMENT_RECEIPT', COMPANY, '26-27', 3)).toBe(
      'RC/26-27/00003',
    );
  });

  it('every series stays within GST Rule 46: at most 16 characters of letters, digits, "/" and "-"', () => {
    for (const type of TYPES) {
      for (const scope of [GUJARAT, COMPANY]) {
        const n = formatDocumentNumber(type, scope, '99-00', 99999);
        expect(n.length).toBeLessThanOrEqual(DOCUMENT_NUMBER_MAX_LENGTH);
        expect(n).toMatch(/^[A-Za-z0-9/-]+$/);
      }
    }
  });

  it('a full series is refused with a clear conflict, never wrapped or widened', () => {
    expect(() =>
      formatDocumentNumber('SALES_INVOICE', GUJARAT, '26-27', 100000),
    ).toThrow(ConflictException);
    expect(() =>
      formatDocumentNumber('SALES_INVOICE', GUJARAT, '26-27', 100000),
    ).toThrow(/is full/);
  });

  it('rejects impossible input', () => {
    expect(() =>
      formatDocumentNumber('SALES_INVOICE', GUJARAT, '26-27', 0),
    ).toThrow();
    expect(() =>
      formatDocumentNumber('SALES_INVOICE', GUJARAT, '26-27', 1.5),
    ).toThrow();
    expect(() =>
      documentNumberPrefix(
        'SALES_INVOICE',
        { kind: 'registration', gstRegistrationId: 'x', stateCode: '2A' },
        '26-27',
      ),
    ).toThrow();
  });

  it('allocation runs one atomic upsert on the series row and numbers by the Indian financial year of the document date', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const tx = {
      $queryRaw: jest.fn(
        (strings: TemplateStringsArray, ...values: unknown[]) => {
          calls.push({ sql: strings.join('?'), values });
          return Promise.resolve([{ lastNumber: 12 }]);
        },
      ),
    };
    // 31 March 2027 19:00 UTC is already 1 April 2027 in India: FY 2027-28
    const out = await allocateDocumentNumber(
      tx as never,
      'SALES_INVOICE',
      GUJARAT,
      new Date('2027-03-31T19:00:00Z'),
    );
    expect(out).toEqual({
      number: 'SI24/27-28/00012',
      prefix: 'SI24/27-28/',
      sequence: 12,
      financialYear: '2027-28',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/INSERT INTO "DocumentNumberCounter"/);
    expect(calls[0].sql).toMatch(
      /ON CONFLICT \("documentType", "scopeKey", "financialYear"\)/,
    );
    expect(calls[0].sql).toMatch(
      /"lastNumber" = "DocumentNumberCounter"\."lastNumber" \+ 1/,
    );
    expect(calls[0].values).toEqual(['SALES_INVOICE', 'gst-24', '2027-28']);
  });

  it('a company-wide series uses the COMPANY scope key', async () => {
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([{ lastNumber: 1 }])),
    };
    const out = await allocateDocumentNumber(
      tx as never,
      'PAYMENT_RECEIPT',
      COMPANY,
      new Date('2026-10-10T00:00:00Z'),
    );
    expect(out.number).toBe('RC/26-27/00001');
    expect((tx.$queryRaw.mock.calls[0] as unknown[]).slice(1)).toEqual([
      'PAYMENT_RECEIPT',
      'COMPANY',
      '2026-27',
    ]);
  });
});

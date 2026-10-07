/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- the fake database is intentionally loosely typed */
import { NotFoundException } from '@nestjs/common';

import { CustomerOverviewService } from './customer-overview.service';

type Row = Record<string, any>;

const customer = (over: Row = {}): Row => ({
  id: 'c1',
  customerCode: 'CUST001',
  customerName: 'Raj Traders',
  isActive: true,
  gstRegistrations: [{ id: 'g1', isActive: true, isDefault: true }],
  ...over,
});

function makeService(data: {
  customer?: Row | null;
  opportunities?: Row[];
  quotations?: Row[];
  proformas?: Row[];
  salesOrders?: Row[];
  invoices?: Row[];
  legacyMatches?: Row[];
}) {
  const calls: string[] = [];
  const fn = (name: string, rows: Row[] | undefined) =>
    jest.fn(async () => {
      calls.push(name);
      return rows ?? [];
    });

  const prisma: any = {
    customer: {
      findUnique: jest.fn(async () =>
        data.customer === undefined ? customer() : data.customer,
      ),
    },
    opportunity: { findMany: fn('opportunity', data.opportunities) },
    quotation: { findMany: fn('quotation', data.quotations) },
    proformaInvoice: { findMany: fn('proforma', data.proformas) },
    salesOrder: { findMany: fn('salesOrder', data.salesOrders) },
    salesInvoice: { findMany: fn('invoice', data.invoices) },
    $queryRaw: jest.fn(async () => {
      calls.push('legacy');
      return data.legacyMatches ?? [];
    }),
  };

  return { service: new CustomerOverviewService(prisma), prisma, calls };
}

describe('Customer overview', () => {
  it('is 404 for an unknown customer', async () => {
    const { service } = makeService({ customer: null });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reads nothing below the opportunities when the customer has none, and still lists legacy matches', async () => {
    const { service, calls } = makeService({
      legacyMatches: [
        {
          id: 'o9',
          title: 'Pump deal',
          matchedBy: 'LEAD_NAME',
          quotationCount: 4,
        },
      ],
    });

    const res = await service.get('c1');

    expect(calls).toEqual(['opportunity', 'legacy']);
    expect(res.legacyMatches).toHaveLength(1);
    expect(res.totals).toMatchObject({
      counts: {
        opportunities: 0,
        quotations: 0,
        proformas: 0,
        salesOrders: 0,
        invoices: 0,
      },
      approvedQuotationValue: 0,
      orderedValue: 0,
      invoicedValue: 0,
      collectedValue: 0,
      outstandingValue: 0,
    });
  });

  it('follows the chain by id and totals each set over its own rows', async () => {
    const past = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000);

    const { service, calls } = makeService({
      opportunities: [{ id: 'o1' }, { id: 'o2' }],
      quotations: [
        { id: 'q1', status: 'APPROVED', totalAmount: 118000 },
        { id: 'q2', status: 'REVISED', totalAmount: 295000 },
        { id: 'q3', status: 'APPROVED', totalAmount: 250000.5 },
        { id: 'q4', status: 'REJECTED', totalAmount: 1000 },
      ],
      proformas: [
        { id: 'p1', validityDate: past, customerStatus: 'APPROVED' },
        { id: 'p2', validityDate: future, customerStatus: 'PENDING' },
        { id: 'p3', validityDate: null, customerStatus: 'PENDING' },
      ],
      salesOrders: [
        { id: 's1', status: 'READY_FOR_INVOICING', totalAmount: 118000 },
        { id: 's2', status: 'CANCELLED', totalAmount: 250000 },
      ],
      invoices: [
        {
          id: 'i0',
          status: 'DRAFT',
          totalAmount: 5000,
          receivables: [
            { paidAmount: 999, balanceAmount: 999, paymentStatus: 'PENDING' },
          ],
        },
        {
          id: 'i1',
          status: 'POSTED',
          totalAmount: 118000,
          receivables: [
            {
              paidAmount: 18000,
              balanceAmount: 100000,
              paymentStatus: 'PARTIAL',
            },
          ],
        },
        {
          id: 'i2',
          status: 'POSTED',
          totalAmount: 50000,
          receivables: [
            {
              paidAmount: 0,
              balanceAmount: -117700,
              paymentStatus: 'WRITTEN_OFF',
            },
          ],
        },
      ],
    });

    const res = await service.get('c1');

    expect(calls).toEqual([
      'opportunity',
      'quotation',
      'proforma',
      'salesOrder',
      'invoice',
      'legacy',
    ]);
    expect(res.proformas.map((p: any) => [p.id, p.isExpired])).toEqual([
      ['p1', true],
      ['p2', false],
      ['p3', false],
    ]);
    expect(res.totals).toEqual({
      counts: {
        opportunities: 2,
        quotations: 4,
        proformas: 3,
        salesOrders: 2,
        invoices: 3,
      },
      approvedQuotationValue: 368000.5,
      orderedValue: 118000,
      invoicedValue: 168000,
      collectedValue: 18000,
      outstandingValue: 100000,
    });
  });

  it('says whether the customer can be quoted, and why not', async () => {
    const ready = await makeService({}).service.get('c1');
    expect(ready.quotingReadiness).toEqual({ ready: true, reasons: [] });

    const inactive = await makeService({
      customer: customer({ isActive: false }),
    }).service.get('c1');
    expect(inactive.quotingReadiness).toEqual({
      ready: false,
      reasons: ['CUSTOMER_INACTIVE'],
    });

    const noGst = await makeService({
      customer: customer({
        gstRegistrations: [{ id: 'g1', isActive: false, isDefault: false }],
      }),
    }).service.get('c1');
    expect(noGst.quotingReadiness).toEqual({
      ready: false,
      reasons: ['NO_ACTIVE_GST'],
    });

    const both = await makeService({
      customer: customer({ isActive: false, gstRegistrations: [] }),
    }).service.get('c1');
    expect(both.quotingReadiness.reasons).toEqual([
      'CUSTOMER_INACTIVE',
      'NO_ACTIVE_GST',
    ]);
  });

  it('writes nothing', async () => {
    const { prisma } = makeService({ opportunities: [{ id: 'o1' }] });
    const service = new CustomerOverviewService(prisma);
    await service.get('c1');

    for (const model of [
      'customer',
      'opportunity',
      'quotation',
      'proformaInvoice',
      'salesOrder',
      'salesInvoice',
    ]) {
      for (const write of [
        'create',
        'update',
        'updateMany',
        'delete',
        'upsert',
      ]) {
        expect(prisma[model][write]).toBeUndefined();
      }
    }
  });
});

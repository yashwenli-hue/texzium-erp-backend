import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../core/database/prisma.service';
import { isProformaExpired } from '../proforma-invoices/proforma-lifecycle';
import {
  QUOTATION_STATUS,
  roundMoney,
} from '../quotations/quotation-lifecycle';
import {
  CUSTOMER_INCLUDE,
  CUSTOMER_NOT_FOUND_MESSAGE,
} from './customer-lifecycle';
import { findLegacyMatches } from './customer-legacy-matches';
import {
  ALL_RECORDS,
  RecordScope,
  and,
  opportunityWhere,
} from '../record-scope/record-scope';

const SALES_ORDER_CANCELLED = 'CANCELLED';
const INVOICE_DRAFT = 'DRAFT';
const RECEIVABLE_WRITTEN_OFF = 'WRITTEN_OFF';

const sum = (values: number[]) =>
  roundMoney(values.reduce((total, v) => total + v, 0));

// Everything a customer has in the quote-to-cash chain, read in one place.
//
// The chain is followed by id, never by name: customer -> opportunities (their
// customerId) -> quotations -> proformas -> sales orders (directly or through
// their proforma) -> invoices -> receivables. Invoices and receivables belong
// to FinanceOS; they are read here, as recorded, and nothing is written. An
// opportunity that has not been linked to this customer is not part of it,
// however much its lead looks like the customer: those are listed apart as
// "possible legacy matches", to be linked by a person, and are not counted in
// any total.
@Injectable()
export class CustomerOverviewService {
  constructor(private prisma: PrismaService) {}

  // Scoped: only the opportunities (and so the documents under them) the caller may see;
  // a colleague's deal with the same customer is not shown to a scoped user.
  async get(id: string, scope: RecordScope = ALL_RECORDS) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: CUSTOMER_INCLUDE,
    });

    if (!customer) {
      throw new NotFoundException(CUSTOMER_NOT_FOUND_MESSAGE);
    }

    const opportunities = await this.prisma.opportunity.findMany({
      where: and<Prisma.OpportunityWhereInput>(
        { customerId: id },
        opportunityWhere(scope),
      ),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        opportunityCode: true,
        title: true,
        status: true,
        expectedValue: true,
        probability: true,
        expectedCloseDate: true,
        createdAt: true,
        lead: {
          select: {
            id: true,
            customerName: true,
            companyName: true,
            isActive: true,
          },
        },
      },
    });

    const opportunityIds = opportunities.map((o) => o.id);

    const quotations = opportunityIds.length
      ? await this.prisma.quotation.findMany({
          where: { opportunityId: { in: opportunityIds } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            quotationCode: true,
            opportunityId: true,
            quoteDate: true,
            status: true,
            taxableAmount: true,
            gstAmount: true,
            totalAmount: true,
            buyerGstId: true,
            createdAt: true,
          },
        })
      : [];

    const quotationIds = quotations.map((q) => q.id);

    const proformas = quotationIds.length
      ? await this.prisma.proformaInvoice.findMany({
          where: { quotationId: { in: quotationIds } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            proformaNumber: true,
            quotationId: true,
            issueDate: true,
            customerStatus: true,
            totalAmount: true,
            validityDate: true,
            createdAt: true,
          },
        })
      : [];

    const proformaIds = proformas.map((p) => p.id);

    const salesOrders = quotationIds.length
      ? await this.prisma.salesOrder.findMany({
          where: {
            OR: [
              { quotationId: { in: quotationIds } },
              { proformaInvoiceId: { in: proformaIds } },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            salesOrderCode: true,
            orderDate: true,
            status: true,
            totalAmount: true,
            quotationId: true,
            proformaInvoiceId: true,
            createdAt: true,
          },
        })
      : [];

    const salesOrderIds = salesOrders.map((o) => o.id);

    const invoices = salesOrderIds.length
      ? await this.prisma.salesInvoice.findMany({
          where: { salesOrderId: { in: salesOrderIds } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            invoiceNumber: true,
            salesOrderId: true,
            invoiceDate: true,
            status: true,
            paymentStatus: true,
            totalAmount: true,
            receivables: {
              select: {
                id: true,
                dueDate: true,
                outstandingAmount: true,
                paidAmount: true,
                balanceAmount: true,
                paymentStatus: true,
              },
            },
          },
        })
      : [];

    const legacyMatches = await findLegacyMatches(
      this.prisma,
      customer.customerName,
    );

    const now = new Date();

    // Totals, each over its own set:
    //  - approvedQuotationValue: APPROVED quotations
    //  - orderedValue: Sales Orders that are not cancelled
    //  - invoicedValue: invoices that are not drafts
    //  - collectedValue / outstandingValue: the receivables of those invoices,
    //    as FinanceOS recorded them (outstanding leaves out written-off ones)
    const postedInvoices = invoices.filter((i) => i.status !== INVOICE_DRAFT);
    const receivables = postedInvoices.flatMap((i) => i.receivables);

    const activeRegistrations = customer.gstRegistrations.filter(
      (g) => g.isActive,
    );

    const notReadyReasons: string[] = [];

    if (!customer.isActive) notReadyReasons.push('CUSTOMER_INACTIVE');
    if (activeRegistrations.length === 0) notReadyReasons.push('NO_ACTIVE_GST');

    return {
      customer,
      quotingReadiness: {
        ready: notReadyReasons.length === 0,
        reasons: notReadyReasons,
      },
      opportunities,
      quotations,
      proformas: proformas.map((p) => ({
        ...p,
        isExpired: isProformaExpired(p.validityDate, now),
      })),
      salesOrders,
      invoices,
      totals: {
        counts: {
          opportunities: opportunities.length,
          quotations: quotations.length,
          proformas: proformas.length,
          salesOrders: salesOrders.length,
          invoices: invoices.length,
        },
        approvedQuotationValue: sum(
          quotations
            .filter((q) => q.status === QUOTATION_STATUS.APPROVED)
            .map((q) => q.totalAmount),
        ),
        orderedValue: sum(
          salesOrders
            .filter((o) => o.status !== SALES_ORDER_CANCELLED)
            .map((o) => o.totalAmount),
        ),
        invoicedValue: sum(postedInvoices.map((i) => i.totalAmount)),
        collectedValue: sum(receivables.map((r) => r.paidAmount)),
        outstandingValue: sum(
          receivables
            .filter((r) => r.paymentStatus !== RECEIVABLE_WRITTEN_OFF)
            .map((r) => r.balanceAmount),
        ),
      },
      // Opportunities that are not linked to any customer but whose lead
      // carries this customer's name. A guess by name, for a person to confirm
      // by linking; never counted above.
      legacyMatches,
    };
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service';
import { CUSTOMER_NOT_FOUND_MESSAGE } from '../customer-master/customer-lifecycle';
import { findLegacyMatches } from '../customer-master/customer-legacy-matches';
import { StatementQueryDto } from './dto/statement-query.dto';
import {
  beforePeriod,
  buildStatementFigures,
  netPaise,
  periodBounds,
  STATEMENT_ENTRY_LIMIT,
  StatementFigures,
} from './statement-calculator';

const INVOICE_DRAFT = 'DRAFT';

export const STATEMENT_TOO_LONG_MESSAGE = `This statement would have more than ${STATEMENT_ENTRY_LIMIT.toLocaleString('en-IN')} entries. Choose a shorter period.`;

export interface CustomerStatement extends StatementFigures {
  customer: {
    id: string;
    customerCode: string;
    customerName: string;
    isActive: boolean;
  };
  period: { from: string | null; to: string | null };
  currency: 'INR';
  coverage: {
    // posted invoices of this customer with no CustomerLedger row at all
    postedInvoicesWithoutLedgerEntries: number;
    // opportunities not linked to any customer whose lead looks like this one
    unlinkedLegacyMatches: number;
  };
  generatedAt: string;
}

// A customer's ledger statement, read only.
//
// Which ledger rows: those of this customer's invoices, found by id exactly as the
// customer overview finds them - customer -> opportunities (their customerId) ->
// quotations -> proformas -> sales orders (directly or through their proforma) ->
// invoices -> CustomerLedger rows of those invoices. Never by name: ledger and invoice
// names are free text, customer names change and are not unique. Rows of opportunities
// that are not linked to the customer are left out and only counted (coverage).
@Injectable()
export class CustomerStatementsService {
  constructor(private prisma: PrismaService) {}

  async statement(
    customerId: string,
    query: StatementQueryDto,
  ): Promise<CustomerStatement> {
    const from = query.from ?? null;
    const to = query.to ?? null;

    if (from && to && from > to) {
      throw new BadRequestException(
        'The start date must not be after the end date.',
      );
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        customerCode: true,
        customerName: true,
        isActive: true,
      },
    });

    if (!customer) {
      throw new NotFoundException(CUSTOMER_NOT_FOUND_MESSAGE);
    }

    const invoices = await this.customerInvoices(customer.id);
    const invoiceIds = invoices.map((i) => i.id);
    const invoiceNumbers = new Map(
      invoices.map((i) => [i.id, i.invoiceNumber]),
    );

    let figures: StatementFigures = buildStatementFigures(
      0,
      [],
      invoiceNumbers,
    );
    let postedInvoicesWithoutLedgerEntries = 0;

    if (invoiceIds.length > 0) {
      const ofTheseInvoices = { salesInvoiceId: { in: invoiceIds } };
      const period = { ...ofTheseInvoices, entryDate: periodBounds(from, to) };

      const count = await this.prisma.customerLedger.count({ where: period });
      if (count > STATEMENT_ENTRY_LIMIT) {
        throw new UnprocessableEntityException(STATEMENT_TOO_LONG_MESSAGE);
      }

      const before = from
        ? await this.prisma.customerLedger.findMany({
            where: { ...ofTheseInvoices, entryDate: beforePeriod(from) },
            select: { debitAmount: true, creditAmount: true },
          })
        : [];

      const rows = await this.prisma.customerLedger.findMany({
        where: period,
        orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          salesInvoiceId: true,
          entryDate: true,
          createdAt: true,
          debitAmount: true,
          creditAmount: true,
          remarks: true,
        },
      });

      figures = buildStatementFigures(netPaise(before), rows, invoiceNumbers);

      const withLedger = await this.prisma.customerLedger.findMany({
        where: ofTheseInvoices,
        select: { salesInvoiceId: true },
        distinct: ['salesInvoiceId'],
      });
      const ledgered = new Set(withLedger.map((r) => r.salesInvoiceId));
      postedInvoicesWithoutLedgerEntries = invoices.filter(
        (i) => i.status !== INVOICE_DRAFT && !ledgered.has(i.id),
      ).length;
    }

    const legacy = await findLegacyMatches(this.prisma, customer.customerName);

    return {
      customer,
      period: { from, to },
      currency: 'INR',
      ...figures,
      coverage: {
        postedInvoicesWithoutLedgerEntries,
        unlinkedLegacyMatches: legacy.length,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // The customer's invoices, by id only (the same chain as the customer overview).
  private async customerInvoices(customerId: string) {
    const opportunities = await this.prisma.opportunity.findMany({
      where: { customerId },
      select: { id: true },
    });
    const opportunityIds = opportunities.map((o) => o.id);
    if (opportunityIds.length === 0) return [];

    const quotations = await this.prisma.quotation.findMany({
      where: { opportunityId: { in: opportunityIds } },
      select: { id: true },
    });
    const quotationIds = quotations.map((q) => q.id);
    if (quotationIds.length === 0) return [];

    const proformas = await this.prisma.proformaInvoice.findMany({
      where: { quotationId: { in: quotationIds } },
      select: { id: true },
    });
    const proformaIds = proformas.map((p) => p.id);

    const salesOrders = await this.prisma.salesOrder.findMany({
      where: {
        OR: [
          { quotationId: { in: quotationIds } },
          { proformaInvoiceId: { in: proformaIds } },
        ],
      },
      select: { id: true },
    });
    const salesOrderIds = salesOrders.map((o) => o.id);
    if (salesOrderIds.length === 0) return [];

    return this.prisma.salesInvoice.findMany({
      where: { salesOrderId: { in: salesOrderIds } },
      select: { id: true, invoiceNumber: true, status: true },
    });
  }
}

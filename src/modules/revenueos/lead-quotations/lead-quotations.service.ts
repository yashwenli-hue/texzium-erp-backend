import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service';
import {
  QUOTATION_PROGRESS_LABEL,
  quotationProgress,
} from './lead-quotation-progress';

/**
 * The quotations made on a lead's opportunities, WITHOUT any price: for people who
 * may see the lead (Pre-Sales) but not the commercial terms. Every field is listed
 * explicitly below, so no amount, rate, tax or total can reach the response.
 */
@Injectable()
export class LeadQuotationsService {
  constructor(private readonly prisma: PrismaService) {}

  async forLead(leadId: string) {
    const quotations = await this.prisma.quotation.findMany({
      where: { opportunity: { leadId } },
      orderBy: [{ quoteDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        quotationCode: true,
        quoteDate: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        opportunity: { select: { id: true, title: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          select: { lineNumber: true, description: true, quantity: true },
        },
        proformaInvoices: {
          orderBy: { createdAt: 'asc' },
          select: {
            proformaNumber: true,
            issueDate: true,
            customerStatus: true,
            salesOrders: {
              select: { salesOrderCode: true, orderDate: true, status: true },
            },
          },
        },
        salesOrders: {
          select: { salesOrderCode: true, orderDate: true, status: true },
        },
      },
    });

    return quotations.map((q) => {
      const proformas = q.proformaInvoices;
      const orders = [
        ...proformas.flatMap((p) => p.salesOrders),
        ...q.salesOrders,
      ];
      const progress = quotationProgress({
        status: q.status,
        proformaStatuses: proformas.map((p) => p.customerStatus),
        orderStatuses: orders.map((o) => o.status),
      });
      const proforma = proformas.find((p) => p.customerStatus !== 'CANCELLED');
      const order = orders.find((o) => o.status !== 'CANCELLED');
      return {
        id: q.id,
        quotationCode: q.quotationCode,
        quoteDate: q.quoteDate,
        status: q.status,
        progress,
        progressLabel: QUOTATION_PROGRESS_LABEL[progress],
        opportunity: q.opportunity,
        lines: q.lines,
        proforma: proforma
          ? { number: proforma.proformaNumber, issueDate: proforma.issueDate }
          : null,
        order: order
          ? { code: order.salesOrderCode, orderDate: order.orderDate }
          : null,
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
      };
    });
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class CustomerProfitabilityService {
  constructor(private prisma: PrismaService) {}

async summary() {
  const invoices =
    await this.prisma.salesInvoice.findMany();

  const result: Record<
    string,
    {
      revenue: number;
      estimatedCost: number;
      profit: number;
    }
  > = {};

  for (const invoice of invoices) {
    const customerName =
      invoice.customerName || 'UNKNOWN_CUSTOMER';

    if (!result[customerName]) {
      result[customerName] = {
        revenue: 0,
        estimatedCost: 0,
        profit: 0,
      };
    }

    result[customerName].revenue +=
      invoice.totalAmount;

    result[customerName].estimatedCost +=
      invoice.taxableAmount * 0.70;

    result[customerName].profit =
      result[customerName].revenue -
      result[customerName].estimatedCost;
  }

  return result;
}

}

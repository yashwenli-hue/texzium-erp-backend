import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class GstReconciliationService {
  constructor(private prisma: PrismaService) {}

  async reconcile() {
    const vendorBills =
      await this.prisma.vendorBill.findMany();

    const totalPurchaseValue =
      vendorBills.reduce(
        (sum, bill) => sum + bill.totalAmount,
        0,
      );

    const totalGSTClaimable =
      vendorBills.reduce(
        (sum, bill) => sum + bill.taxAmount,
        0,
      );

    return {
      totalBills: vendorBills.length,
      totalPurchaseValue,
      totalGSTClaimable,
      itcStatus: 'ELIGIBLE',
    };
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class CollectionRemindersService {
  constructor(private prisma: PrismaService) {}

  async checkDue() {
    const receivables = await this.prisma.accountsReceivable.findMany({
      where: {
        balanceAmount: {
          gt: 0,
        },
      },
      include: {
        salesInvoice: true,
      },
    });

    const today = new Date();

    return receivables.map((r) => {
      const dueDate = new Date(r.dueDate);

      const diffDays = Math.ceil(
        (dueDate.getTime() - today.getTime()) /
        (1000 * 60 * 60 * 24),
      );

      let reminderType = '';

      if (diffDays > 0 && diffDays <= 3) reminderType = 'UPCOMING';
      if (diffDays === 0) reminderType = 'DUE_TODAY';
      if (diffDays < 0) reminderType = 'OVERDUE';

      return {
        salesInvoiceId: r.salesInvoiceId,
        customerName: r.salesInvoice.customerName,
        balanceAmount: r.balanceAmount,
        dueDate: r.dueDate,
        daysRemaining: diffDays,
        reminderType,
      };
    });
  }
}

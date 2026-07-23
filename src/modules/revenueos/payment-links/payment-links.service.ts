import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class PaymentLinksService {
  constructor(private prisma: PrismaService) {}

  async generate(salesInvoiceId: string) {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: {
        id: salesInvoiceId,
      },
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    const gateway =
      await this.prisma.paymentGatewayConfig.findFirst({
        where: {
          isActive: true,
        },
      });

    if (gateway) {
      const paymentLink =
        `https://pay.${gateway.gatewayName.toLowerCase()}.com/${invoice.id}`;

      return {
        mode: 'ONLINE',
        gateway: gateway.gatewayName,
        amount: invoice.totalAmount,
        paymentLink,
      };
    }

    const manualConfig =
      await this.prisma.paymentGatewayConfig.findFirst();

    if (!manualConfig) {
      throw new Error(
        'No payment configuration found',
      );
    }

    return {
      mode: 'MANUAL',
      amount: invoice.totalAmount,
      bankName: manualConfig.bankName,
      accountName: manualConfig.accountName,
      accountNumber: manualConfig.accountNumber,
      ifscCode: manualConfig.ifscCode,
      upiId: manualConfig.upiId,
    };
  }
}

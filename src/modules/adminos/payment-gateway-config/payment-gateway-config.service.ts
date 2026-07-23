import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreatePaymentGatewayDto } from './dto/create-payment-gateway.dto';

@Injectable()
export class PaymentGatewayConfigService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreatePaymentGatewayDto) {
    if (data.isActive) {
      await this.prisma.paymentGatewayConfig.updateMany({
        data: {
          isActive: false,
        },
      });
    }

    return this.prisma.paymentGatewayConfig.create({
      data,
    });
  }

  async findAll() {
    return this.prisma.paymentGatewayConfig.findMany();
  }

  async getActiveGateway() {
    return this.prisma.paymentGatewayConfig.findFirst({
      where: {
        isActive: true,
      },
    });
  }
}

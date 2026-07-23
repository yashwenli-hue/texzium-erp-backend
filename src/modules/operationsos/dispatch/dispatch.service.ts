import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateDispatchDto } from './dto/create-dispatch.dto';

@Injectable()
export class DispatchService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateDispatchDto) {
    const salesInvoice = await this.prisma.salesInvoice.findFirst({
      where: {
        salesOrderId: data.salesOrderId,
      },
    });

    if (!salesInvoice) {
      throw new Error(
        'Sales Invoice not found. Dispatch not allowed.',
      );
    }

    const gstRegistry = await this.prisma.gSTInvoiceRegistry.findFirst({
      where: {
        salesInvoiceId: salesInvoice.id,
      },
    });

    if (!gstRegistry || gstRegistry.status !== 'EWAY_GENERATED') {
      throw new Error(
        'E-Way Bill not generated. Dispatch blocked.',
      );
    }

    return this.prisma.dispatch.create({
      data: {
        salesOrderId: data.salesOrderId,
        dispatchDate: new Date(data.dispatchDate),
        vehicleNumber: data.vehicleNumber,
        driverName: data.driverName,
        trackingNumber: data.trackingNumber,
      },
    });
  }

  async findAll() {
    return this.prisma.dispatch.findMany({
      include: {
        salesOrder: true,
      },
    });
  }
}

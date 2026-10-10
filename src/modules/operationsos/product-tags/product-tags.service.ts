import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { USER_REFERENCE_SELECT } from '../../../core/security/user-select';
import { CreateProductTagDto } from './dto/create-product-tag.dto';

@Injectable()
export class ProductTagsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateProductTagDto) {
    return this.prisma.productTag.create({
      data: {
        inventoryItemId: data.inventoryItemId,
        salesOrderId: data.salesOrderId,
        customerName: data.customerName,
        salesPersonId: data.salesPersonId,
        serialNumber: data.serialNumber,
        qrCode: `QR-${data.serialNumber}`,
      },
    });
  }

  async findAll() {
    return this.prisma.productTag.findMany({
      include: {
        inventoryItem: true,
        salesOrder: true,
        salesPerson: { select: USER_REFERENCE_SELECT },
      },
    });
  }

  async scan(serialNumber: string) {
    return this.prisma.productTag.findUnique({
      where: {
        serialNumber,
      },
      include: {
        inventoryItem: true,
        salesOrder: true,
        salesPerson: { select: USER_REFERENCE_SELECT },
      },
    });
  }
}

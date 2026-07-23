import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { WarrantyPolicyType } from '@prisma/client';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateInventoryItemDto) {
    // Validate HSN if provided
    if (data.hsnMasterId) {
      const hsn = await this.prisma.hSNMaster.findUnique({
        where: {
          id: data.hsnMasterId,
        },
      });

      if (!hsn) {
        throw new Error('HSN Master not found');
      }
    }

    return this.prisma.inventoryItem.create({
      data: {
        sku: data.sku,
        productName: data.productName,
        category: data.category,
        stockQty: data.stockQty,
        reservedQty: data.reservedQty,
        availableQty: data.availableQty,
        warehouse: data.warehouse,
        condition: data.condition,
        hsnMasterId: data.hsnMasterId,

        warrantyApplicable: data.warrantyApplicable ?? false,
        warrantyPolicyType: data.warrantyPolicyType
          ? (data.warrantyPolicyType as WarrantyPolicyType)
          : WarrantyPolicyType.NONE,
        warrantyMonths: data.warrantyMonths ?? null,
      },
    });
  }

  async findAll() {
    return this.prisma.inventoryItem.findMany({
      include: {
        hsnMaster: true,
      },
    });
  }
}

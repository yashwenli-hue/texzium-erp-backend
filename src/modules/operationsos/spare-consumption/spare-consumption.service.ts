import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSpareConsumptionDto } from './dto/create-spare-consumption.dto';

@Injectable()
export class SpareConsumptionService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateSpareConsumptionDto) {
    const inventory = await this.prisma.inventoryItem.findUnique({
      where: { id: data.inventoryItemId },
    });

    if (!inventory) {
      throw new Error('Inventory item not found');
    }

    if (inventory.availableQty < data.quantityUsed) {
      throw new Error('Insufficient stock');
    }

    const totalCost = data.quantityUsed * data.unitCost;

    await this.prisma.inventoryItem.update({
      where: { id: inventory.id },
      data: {
        stockQty: inventory.stockQty - data.quantityUsed,
        availableQty: inventory.availableQty - data.quantityUsed,
      },
    });

    return this.prisma.spareConsumption.create({
      data: {
        engineerVisitId: data.engineerVisitId,
        inventoryItemId: data.inventoryItemId,
        quantityUsed: data.quantityUsed,
        unitCost: data.unitCost,
        totalCost,
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.spareConsumption.findMany({
      include: {
        engineerVisit: true,
        inventoryItem: true,
      },
    });
  }
}

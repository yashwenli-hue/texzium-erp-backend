import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSpareConsumptionDto } from './dto/create-spare-consumption.dto';
import { ConsumptionService } from '../inventory-engine/services/consumption.service';

@Injectable()
export class SpareConsumptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consumptionService: ConsumptionService,
  ) {}

  async create(data: CreateSpareConsumptionDto) {
    return this.prisma.$transaction(async (tx) => {
      const engineerVisit = await tx.engineerVisit.findUnique({
        where: {
          id: data.engineerVisitId,
        },
      });

      if (!engineerVisit) {
        throw new NotFoundException(
          'Engineer Visit not found.',
        );
      }

      if (data.quantityUsed <= 0) {
        throw new BadRequestException(
          'Quantity used must be greater than zero.',
        );
      }

      if (data.unitCost < 0) {
        throw new BadRequestException(
          'Unit cost cannot be negative.',
        );
      }

      /*
       * Generate the Spare Consumption ID before inventory consumption.
       *
       * This ID becomes the canonical reference for:
       * - InventoryTransaction
       * - InventoryMovement
       * - SpareConsumption
       */
      const spareConsumptionId = crypto.randomUUID();

      const inventoryResult =
        await this.consumptionService.consumeInventory(
          tx,
          {
            inventoryItemId: data.inventoryItemId,

            warehouseId: data.warehouseId,

            warehouseBinId: data.warehouseBinId,

            batchId: data.batchId,

            serialId: data.serialId,

            quantity: data.quantityUsed,

            unitCost: data.unitCost,

            referenceModule: 'SpareConsumption',

            referenceId: spareConsumptionId,

            remarks: data.remarks,
          },
        );

      const totalCost =
        data.quantityUsed * data.unitCost;

      const spareConsumption =
        await tx.spareConsumption.create({
          data: {
            id: spareConsumptionId,

            engineerVisitId:
              data.engineerVisitId,

            inventoryItemId:
              data.inventoryItemId,

            warehouseId:
              data.warehouseId,

            warehouseBinId:
              data.warehouseBinId,

            batchId:
              data.batchId,

            serialId:
              data.serialId,

            quantityUsed:
              data.quantityUsed,

            unitCost:
              data.unitCost,

            totalCost,

            remarks:
              data.remarks,
          },
        });

      return {
        success: true,
        message:
          'Spare consumed successfully.',
        spareConsumption,
        inventory: inventoryResult,
      };
    });
  }

  async findAll() {
    return this.prisma.spareConsumption.findMany({
      include: {
        engineerVisit: true,
        inventoryItem: true,
        warehouse: true,
        warehouseBin: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}

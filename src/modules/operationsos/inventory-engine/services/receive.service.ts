import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { ReceiveInventoryDto } from '../dto/receive-inventory.dto';
import { MovementService } from './movement.service';

@Injectable()
export class ReceiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementService: MovementService,
  ) {}

  async execute(data: ReceiveInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      const goodsReceipt = await tx.goodsReceipt.findUnique({
        where: {
          id: data.goodsReceiptId,
        },
        include: {
          purchaseOrder: {
            include: {
              purchaseRequisition: {
                include: {
                  inventoryItem: true,
                },
              },
            },
          },
        },
      });

      if (!goodsReceipt) {
        throw new NotFoundException('Goods Receipt not found.');
      }

      if (data.quantity <= 0) {
        throw new BadRequestException(
          'Receive quantity must be greater than zero.',
        );
      }

      /*
       * Calculate the quantity already posted into Inventory Engine
       * for this Goods Receipt.
       */
      const existingReceiptMovements =
        await tx.inventoryMovement.findMany({
          where: {
            referenceModule: 'GoodsReceipt',
            referenceId: goodsReceipt.id,
            movementType: 'RECEIPT',
            movementStatus: 'POSTED',
          },
          select: {
            quantity: true,
          },
        });

      const processedQuantity =
        existingReceiptMovements.reduce(
          (total, movement) => total + movement.quantity,
          0,
        );

      const remainingQuantity =
        goodsReceipt.receivedQty - processedQuantity;

      if (remainingQuantity <= 0) {
        throw new BadRequestException(
          'This Goods Receipt has already been fully received into inventory.',
        );
      }

      if (data.quantity > remainingQuantity) {
        throw new BadRequestException(
          `Receive quantity exceeds remaining Goods Receipt quantity. Remaining quantity: ${remainingQuantity}.`,
        );
      }

      const inventoryItem =
        goodsReceipt.purchaseOrder.purchaseRequisition.inventoryItem;

      if (!inventoryItem) {
        throw new NotFoundException(
          'Inventory Item linked to Goods Receipt was not found.',
        );
      }

      const warehouse = await tx.warehouse.findUnique({
        where: {
          id: data.warehouseId,
        },
      });

      if (!warehouse) {
        throw new NotFoundException('Warehouse not found.');
      }

      if (data.warehouseBinId) {
        const warehouseBin = await tx.warehouseBin.findUnique({
          where: {
            id: data.warehouseBinId,
          },
        });

        if (!warehouseBin) {
          throw new NotFoundException('Warehouse Bin not found.');
        }
      }

      const existingBalance =
        await tx.inventoryBalance.findFirst({
          where: {
            inventoryItemId: inventoryItem.id,
            warehouseId: data.warehouseId,
            warehouseBinId:
              data.warehouseBinId ?? null,
            batchId: data.batchId ?? null,
            serialId: data.serialId ?? null,
          },
        });

      let balance;

      if (existingBalance) {
        const quantityOnHand =
          existingBalance.quantityOnHand +
          data.quantity;

        const quantityAvailable =
          existingBalance.quantityAvailable +
          data.quantity;

        balance =
          await tx.inventoryBalance.update({
            where: {
              id: existingBalance.id,
            },
            data: {
              quantityOnHand,
              quantityAvailable,
              averageUnitCost:
                data.unitCost ??
                existingBalance.averageUnitCost,
            },
          });
      } else {
        balance =
          await tx.inventoryBalance.create({
            data: {
              inventoryItemId:
                inventoryItem.id,

              warehouseId:
                data.warehouseId,

              warehouseBinId:
                data.warehouseBinId,

              batchId: data.batchId,

              serialId: data.serialId,

              quantityOnHand:
                data.quantity,

              quantityReserved: 0,

              quantityAvailable:
                data.quantity,

              quantityBlocked: 0,

              quantityDamaged: 0,

              averageUnitCost:
                data.unitCost ?? 0,
            },
          });
      }

      const updatedInventoryItem =
        await tx.inventoryItem.update({
          where: {
            id: inventoryItem.id,
          },
          data: {
            stockQty:
              inventoryItem.stockQty +
              data.quantity,

            availableQty:
              inventoryItem.availableQty +
              data.quantity,
          },
        });

      const movement =
        await this.movementService.create(
          {
            inventoryItemId:
              inventoryItem.id,

            warehouseId:
              data.warehouseId,

            destinationBinId:
              data.warehouseBinId,

            batchId:
              data.batchId,

            serialId:
              data.serialId,

            movementType:
              'RECEIPT',

            movementStatus:
              'POSTED',

            quantity:
              data.quantity,

            unitCost:
              data.unitCost,

            totalCost:
              data.unitCost
                ? data.unitCost *
                  data.quantity
                : undefined,

            referenceModule:
              'GoodsReceipt',

            referenceId:
              goodsReceipt.id,

            remarks:
              data.remarks,

            createdBy:
              data.receivedBy,
          },
          tx,
        );

      return {
        success: true,

        message:
          'Inventory received successfully.',

        inventoryItem:
          updatedInventoryItem,

        balance,

        movement,

        receiptSummary: {
          goodsReceiptQty:
            goodsReceipt.receivedQty,

          previouslyProcessedQty:
            processedQuantity,

          processedQtyAfter:
            processedQuantity +
            data.quantity,

          remainingQtyAfter:
            remainingQuantity -
            data.quantity,
        },
      };
    });
  }
}

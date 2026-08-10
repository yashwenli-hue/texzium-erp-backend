import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service';

import { ReserveService } from './services/reserve.service';
import { PickService } from './services/pick.service';
import { PackService } from './services/pack.service';
import { IssueService } from './services/issue.service';
import { ReleaseService } from './services/release.service';

import { ReserveInventoryDto } from './dto/reserve-inventory.dto';
import { PickInventoryDto } from './dto/pick-inventory.dto';
import { PackInventoryDto } from './dto/pack-inventory.dto';
import { IssueInventoryDto } from './dto/issue-inventory.dto';
import { ReleaseInventoryDto } from './dto/release-inventory.dto';

@Injectable()
export class InventoryEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reserveService: ReserveService,
    private readonly pickService: PickService,
    private readonly packService: PackService,
    private readonly issueService: IssueService,
    private readonly releaseService: ReleaseService,
  ) {}

  async reserveStock(data: ReserveInventoryDto) {
    return this.reserveService.execute(data);
  }

  async pickStock(data: PickInventoryDto) {
    return this.pickService.execute(data);
  }

  async packStock(data: PackInventoryDto) {
    return this.packService.execute(data);
  }

  async issueStock(data: IssueInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      if (data.quantity <= 0) {
        throw new BadRequestException(
          'Issue quantity must be greater than zero.',
        );
      }

      const dispatchItem =
        await tx.dispatchOrderItem.findUnique({
          where: {
            id: data.dispatchOrderItemId,
          },
        });

      if (!dispatchItem) {
        throw new NotFoundException(
          'Dispatch Order Item not found.',
        );
      }

      if (
        dispatchItem.inventoryItemId &&
        dispatchItem.inventoryItemId !== data.inventoryItemId
      ) {
        throw new BadRequestException(
          'Dispatch Order Item does not match the Inventory Item.',
        );
      }

      if (!dispatchItem.warehouseId) {
        throw new BadRequestException(
          'Warehouse is required on the Dispatch Order Item before issue.',
        );
      }

      return this.issueService.issueStock(tx, {
        inventoryItemId: data.inventoryItemId,
        dispatchOrderItemId: data.dispatchOrderItemId,
        quantity: data.quantity,
        warehouseId: dispatchItem.warehouseId,
        referenceModule: 'DispatchOrder',
        referenceId: dispatchItem.dispatchOrderId,
        remarks: data.remarks,
        createdBy: data.issuedBy,
      });
    });
  }

  async releaseStock(data: ReleaseInventoryDto) {
    return this.releaseService.execute(data);
  }
}

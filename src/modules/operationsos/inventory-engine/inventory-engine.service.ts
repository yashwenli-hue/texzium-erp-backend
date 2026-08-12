import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service';

import { ReserveService } from './services/reserve.service';
import { PickService } from './services/pick.service';
import { PackService } from './services/pack.service';
import { IssueService } from './services/issue.service';
import { ReleaseService } from './services/release.service';
import { ReceiveService } from './services/receive.service';
import { TransferService } from './services/transfer.service';

import { ReserveInventoryDto } from './dto/reserve-inventory.dto';
import { PickInventoryDto } from './dto/pick-inventory.dto';
import { PackInventoryDto } from './dto/pack-inventory.dto';
import { IssueInventoryDto } from './dto/issue-inventory.dto';
import { ReleaseInventoryDto } from './dto/release-inventory.dto';
import { ReceiveInventoryDto } from './dto/receive-inventory.dto';
import { TransferInventoryDto } from './dto/transfer-inventory.dto';

import { AdjustmentService } from './services/adjustment.service';
import { AdjustmentInventoryDto } from './dto/adjustment-inventory.dto';

@Injectable()
export class InventoryEngineService {
  constructor(
    private readonly reserveService: ReserveService,
    private readonly pickService: PickService,
    private readonly packService: PackService,
    private readonly issueService: IssueService,
    private readonly releaseService: ReleaseService,
    private readonly receiveService: ReceiveService,
    private readonly transferService: TransferService,
    private readonly adjustmentService: AdjustmentService,
    private readonly prisma: PrismaService,
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
      return this.issueService.issueStock(tx, {
        inventoryItemId: data.inventoryItemId,
        dispatchOrderItemId: data.dispatchOrderItemId,
        quantity: data.quantity,
        warehouseId: data.warehouseId,
        referenceModule: 'DispatchOrder',
        referenceId: data.dispatchOrderItemId,
        remarks: data.remarks,
        createdBy: data.issuedBy,
      });
    });
  }

  async releaseStock(data: ReleaseInventoryDto) {
    return this.releaseService.execute(data);
  }

  async receiveStock(data: ReceiveInventoryDto) {
    return this.receiveService.execute(data);
  }

  async transferStock(data: TransferInventoryDto) {
    return this.transferService.execute(data);
  }

  async adjustStock(data: AdjustmentInventoryDto) {
  return this.adjustmentService.execute(data);
}
}

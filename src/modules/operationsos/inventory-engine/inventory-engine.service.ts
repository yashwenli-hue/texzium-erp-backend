import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { PackService } from './services/pack.service';
import { ReserveInventoryDto } from './dto/reserve-inventory.dto';
import { PickInventoryDto } from './dto/pick-inventory.dto';
import { PackInventoryDto } from './dto/pack-inventory.dto';
import { IssueInventoryDto } from './dto/issue-inventory.dto';

import { ReserveService } from './services/reserve.service';
import { PickService } from './services/pick.service';

@Injectable()
export class InventoryEngineService {
  constructor(
  private readonly reserveService: ReserveService,
  private readonly pickService: PickService,
  private readonly packService: PackService,
  private readonly prisma: PrismaService,
) {}  


  async reserveStock(data: ReserveInventoryDto) {
    return this.reserveService.execute(data);
  }

  async pickStock(data: PickInventoryDto) {
    return this.pickService.execute(data);
  }

  // Keep Pack and Issue here for now.
  // We'll extract them next.

  async packStock(data: PackInventoryDto) {
  return this.packService.execute(data);
}

  async issueStock(data: IssueInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      // Existing Issue logic
      throw new Error('Replace with existing Issue logic temporarily.');
    });
  }
}

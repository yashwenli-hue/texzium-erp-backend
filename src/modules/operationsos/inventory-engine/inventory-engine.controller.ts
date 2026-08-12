import { Body, Controller, Post } from '@nestjs/common';

import { InventoryEngineService } from './inventory-engine.service';

import { ReserveInventoryDto } from './dto/reserve-inventory.dto';
import { PickInventoryDto } from './dto/pick-inventory.dto';
import { PackInventoryDto } from './dto/pack-inventory.dto';
import { IssueInventoryDto } from './dto/issue-inventory.dto';
import { ReleaseInventoryDto } from './dto/release-inventory.dto';
import { ReceiveInventoryDto } from './dto/receive-inventory.dto';
import { TransferInventoryDto } from './dto/transfer-inventory.dto';

@Controller('inventory-engine')
export class InventoryEngineController {
  constructor(
    private readonly inventoryEngineService: InventoryEngineService,
  ) {}

  @Post('reserve')
  reserve(@Body() body: ReserveInventoryDto) {
    return this.inventoryEngineService.reserveStock(body);
  }

  @Post('pick')
  pick(@Body() body: PickInventoryDto) {
    return this.inventoryEngineService.pickStock(body);
  }

  @Post('pack')
  pack(@Body() body: PackInventoryDto) {
    return this.inventoryEngineService.packStock(body);
  }

  @Post('issue')
  issue(@Body() body: IssueInventoryDto) {
    return this.inventoryEngineService.issueStock(body);
  }

  @Post('release')
  release(@Body() body: ReleaseInventoryDto) {
    return this.inventoryEngineService.releaseStock(body);
  }

  @Post('receive')
  receive(@Body() body: ReceiveInventoryDto) {
    return this.inventoryEngineService.receiveStock(body);
  }

  @Post('transfer')
  transfer(@Body() body: TransferInventoryDto) {
    return this.inventoryEngineService.transferStock(body);
  }
}

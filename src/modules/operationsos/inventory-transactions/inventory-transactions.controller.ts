import { Controller, Get } from '@nestjs/common';
import { InventoryTransactionsService } from './inventory-transactions.service';

@Controller('inventory-transactions')
export class InventoryTransactionsController {
  constructor(
    private readonly inventoryTransactionsService: InventoryTransactionsService,
  ) {}

  @Get()
  findAll() {
    return this.inventoryTransactionsService.findAll();
  }
}

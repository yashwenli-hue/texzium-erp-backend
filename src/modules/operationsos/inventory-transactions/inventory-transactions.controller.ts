import { Body, Controller, Get, Post } from '@nestjs/common';
import { InventoryTransactionsService } from './inventory-transactions.service';
import { CreateInventoryTransactionDto } from './dto/create-inventory-transaction.dto';

@Controller('inventory-transactions')
export class InventoryTransactionsController {
  constructor(
    private readonly inventoryTransactionsService: InventoryTransactionsService,
  ) {}

  @Post('create')
  create(@Body() body: CreateInventoryTransactionDto) {
    return this.inventoryTransactionsService.create(body);
  }

  @Get()
  findAll() {
    return this.inventoryTransactionsService.findAll();
  }
}

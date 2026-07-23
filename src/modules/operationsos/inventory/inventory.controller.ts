import { Body, Controller, Get, Post } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  create(@Body() body: CreateInventoryItemDto) {
    return this.inventoryService.create(body);
  }

  @Get()
  findAll() {
    return this.inventoryService.findAll();
  }
}

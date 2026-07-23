import { Body, Controller, Get, Post } from '@nestjs/common';
import { WarehousePutawaysService } from './warehouse-putaways.service';
import { CreateWarehousePutawayDto } from './dto/create-warehouse-putaway.dto';

@Controller('warehouse-putaways')
export class WarehousePutawaysController {
  constructor(
    private readonly warehousePutawaysService: WarehousePutawaysService,
  ) {}

  @Post()
  create(@Body() body: CreateWarehousePutawayDto) {
    return this.warehousePutawaysService.create(body);
  }

  @Get()
  findAll() {
    return this.warehousePutawaysService.findAll();
  }
}

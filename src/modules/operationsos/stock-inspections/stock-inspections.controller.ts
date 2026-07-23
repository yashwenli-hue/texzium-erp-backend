import { Body, Controller, Get, Post } from '@nestjs/common';
import { StockInspectionsService } from './stock-inspections.service';
import { CreateStockInspectionDto } from './dto/create-stock-inspection.dto';

@Controller('stock-inspections')
export class StockInspectionsController {
  constructor(
    private readonly stockInspectionsService: StockInspectionsService,
  ) {}

  @Post()
  create(@Body() body: CreateStockInspectionDto) {
    return this.stockInspectionsService.create(body);
  }

  @Get()
  findAll() {
    return this.stockInspectionsService.findAll();
  }
}

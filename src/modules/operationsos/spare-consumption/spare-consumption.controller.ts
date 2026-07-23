import { Body, Controller, Get, Post } from '@nestjs/common';
import { SpareConsumptionService } from './spare-consumption.service';
import { CreateSpareConsumptionDto } from './dto/create-spare-consumption.dto';

@Controller('spare-consumption')
export class SpareConsumptionController {
  constructor(
    private readonly spareConsumptionService: SpareConsumptionService,
  ) {}

  @Post()
  create(@Body() body: CreateSpareConsumptionDto) {
    return this.spareConsumptionService.create(body);
  }

  @Get()
  findAll() {
    return this.spareConsumptionService.findAll();
  }
}

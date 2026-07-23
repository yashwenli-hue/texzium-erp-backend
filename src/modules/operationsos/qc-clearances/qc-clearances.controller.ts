import { Body, Controller, Get, Post } from '@nestjs/common';
import { QcClearancesService } from './qc-clearances.service';
import { CreateQcClearanceDto } from './dto/create-qc-clearance.dto';

@Controller('qc-clearances')
export class QcClearancesController {
  constructor(
    private readonly qcClearancesService: QcClearancesService,
  ) {}

  @Post()
  create(@Body() body: CreateQcClearanceDto) {
    return this.qcClearancesService.create(body);
  }

  @Get()
  findAll() {
    return this.qcClearancesService.findAll();
  }
}

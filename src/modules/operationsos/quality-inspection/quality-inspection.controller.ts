import { Body, Controller, Get, Post } from '@nestjs/common';
import { QualityInspectionService } from './quality-inspection.service';
import { CreateQualityInspectionDto } from './dto/create-quality-inspection.dto';

@Controller('quality-inspection')
export class QualityInspectionController {
  constructor(
    private readonly qualityInspectionService: QualityInspectionService,
  ) {}

  @Post('create')
  create(@Body() data: CreateQualityInspectionDto) {
    return this.qualityInspectionService.create(data);
  }

  @Get()
  findAll() {
    return this.qualityInspectionService.findAll();
  }
}

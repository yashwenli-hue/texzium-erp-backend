import { Body, Controller, Get, Post } from '@nestjs/common';
import { QualityInspectionsService } from './quality-inspections.service';
import { CreateQualityInspectionDto } from './dto/create-quality-inspection.dto';

@Controller('quality-inspections')
export class QualityInspectionsController {
  constructor(
    private readonly qualityInspectionsService: QualityInspectionsService,
  ) {}

  @Post()
  create(@Body() body: CreateQualityInspectionDto) {
    return this.qualityInspectionsService.create(body);
  }

  @Get()
  findAll() {
    return this.qualityInspectionsService.findAll();
  }
}

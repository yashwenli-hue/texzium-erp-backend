import { Body, Controller, Get, Post } from '@nestjs/common';
import { EngineerVisitsService } from './engineer-visits.service';
import { CreateEngineerVisitDto } from './dto/create-engineer-visit.dto';

@Controller('engineer-visits')
export class EngineerVisitsController {
  constructor(
    private readonly engineerVisitsService: EngineerVisitsService,
  ) {}

  @Post()
  create(@Body() body: CreateEngineerVisitDto) {
    return this.engineerVisitsService.create(body);
  }

  @Get()
  findAll() {
    return this.engineerVisitsService.findAll();
  }
}

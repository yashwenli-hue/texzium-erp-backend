import { Body, Controller, Get, Post } from '@nestjs/common';
import { TreatmentJobsService } from './treatment-jobs.service';
import { CreateTreatmentJobDto } from './dto/create-treatment-job.dto';

@Controller('treatment-jobs')
export class TreatmentJobsController {
  constructor(
    private readonly treatmentJobsService: TreatmentJobsService,
  ) {}

  @Post()
  create(@Body() body: CreateTreatmentJobDto) {
    return this.treatmentJobsService.create(body);
  }

  @Get()
  findAll() {
    return this.treatmentJobsService.findAll();
  }
}

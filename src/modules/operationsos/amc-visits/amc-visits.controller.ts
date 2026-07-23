import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AmcVisitsService } from './amc-visits.service';
import { CreateAmcVisitDto } from './dto/create-amc-visit.dto';

@Controller('amc-visits')
export class AmcVisitsController {
  constructor(private readonly amcVisitsService: AmcVisitsService) {}

  @Post()
  create(@Body() body: CreateAmcVisitDto) {
    return this.amcVisitsService.create(body);
  }

  @Patch(':id/complete')
  complete(
    @Param('id') id: string,
    @Body() body: { remarks: string },
  ) {
    return this.amcVisitsService.completeVisit(id, body.remarks);
  }

  @Get()
  findAll() {
    return this.amcVisitsService.findAll();
  }
}

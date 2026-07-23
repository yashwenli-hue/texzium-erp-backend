import { Body, Controller, Get, Post } from '@nestjs/common';
import { LeadSourcesService } from './lead-sources.service';
import { CreateLeadSourceDto } from './dto/create-lead-source.dto';

@Controller('lead-sources')
export class LeadSourcesController {
  constructor(private readonly leadSourcesService: LeadSourcesService) {}

  @Post()
  create(@Body() body: CreateLeadSourceDto) {
    return this.leadSourcesService.create(body);
  }

  @Get()
  findAll() {
    return this.leadSourcesService.findAll();
  }
}

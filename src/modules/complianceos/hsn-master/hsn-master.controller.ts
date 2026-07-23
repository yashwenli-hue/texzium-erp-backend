import { Body, Controller, Get, Post } from '@nestjs/common';
import { HsnMasterService } from './hsn-master.service';
import { CreateHsnDto } from './dto/create-hsn.dto';

@Controller('hsn-master')
export class HsnMasterController {
  constructor(private readonly hsnMasterService: HsnMasterService) {}

  @Post()
  create(@Body() body: CreateHsnDto) {
    return this.hsnMasterService.create(body);
  }

  @Get()
  findAll() {
    return this.hsnMasterService.findAll();
  }
}

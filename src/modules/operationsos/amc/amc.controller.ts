import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AmcService } from './amc.service';
import { CreateAmcDto } from './dto/create-amc.dto';

@Controller('amc')
export class AmcController {
  constructor(private readonly amcService: AmcService) {}

  @Post()
  create(@Body() body: CreateAmcDto) {
    return this.amcService.create(body);
  }

  @Patch(':id/accept')
  accept(@Param('id') id: string) {
    return this.amcService.acceptAmc(id);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string) {
    return this.amcService.rejectAmc(id);
  }

  @Get()
  findAll() {
    return this.amcService.findAll();
  }
}

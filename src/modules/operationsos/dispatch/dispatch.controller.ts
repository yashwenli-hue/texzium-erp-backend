import { Body, Controller, Get, Post } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { CreateDispatchDto } from './dto/create-dispatch.dto';

@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Post()
  create(@Body() body: CreateDispatchDto) {
    return this.dispatchService.create(body);
  }

  @Get()
  findAll() {
    return this.dispatchService.findAll();
  }
}

import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { DispatchOrdersService } from './dispatch-orders.service';
import { CreateDispatchOrderDto } from './dto/create-dispatch-order.dto';

@Controller('dispatch-orders')
export class DispatchOrdersController {
  constructor(
    private readonly dispatchOrdersService: DispatchOrdersService,
  ) {}

  @Post()
  create(@Body() body: CreateDispatchOrderDto) {
    return this.dispatchOrdersService.create(body);
  }

  @Get()
  findAll() {
    return this.dispatchOrdersService.findAll();
  }

  @Patch(':id/dispatch')
  markDispatched(@Param('id') id: string) {
    return this.dispatchOrdersService.markDispatched(id);
  }
}

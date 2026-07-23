import { Body, Controller, Get, Post } from '@nestjs/common';
import { DispatchOrderItemsService } from './dispatch-order-items.service';
import { CreateDispatchOrderItemDto } from './dto/create-dispatch-order-item.dto';

@Controller('dispatch-order-items')
export class DispatchOrderItemsController {

  constructor(
    private readonly dispatchOrderItemsService: DispatchOrderItemsService,
  ) {}

  @Post('create')
  create(
    @Body() body: CreateDispatchOrderItemDto,
  ) {
    return this.dispatchOrderItemsService.create(body);
  }

  @Get()
  findAll() {
    return this.dispatchOrderItemsService.findAll();
  }

}

import { Body, Controller, Get, Post } from '@nestjs/common';
import { GoodsReceiptService } from './goods-receipt.service';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';

@Controller('goods-receipt')
export class GoodsReceiptController {
  constructor(
    private readonly goodsReceiptService: GoodsReceiptService,
  ) {}

  @Post('create')
  create(@Body() data: CreateGoodsReceiptDto) {
    return this.goodsReceiptService.create(data);
  }

  @Get()
  findAll() {
    return this.goodsReceiptService.findAll();
  }
}

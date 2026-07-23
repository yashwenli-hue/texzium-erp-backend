import { Body, Controller, Get, Post } from '@nestjs/common';
import { GoodsReceiptsService } from './goods-receipts.service';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';

@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(
    private readonly goodsReceiptsService: GoodsReceiptsService,
  ) {}

  @Post()
  create(@Body() body: CreateGoodsReceiptDto) {
    return this.goodsReceiptsService.create(body);
  }

  @Get()
  findAll() {
    return this.goodsReceiptsService.findAll();
  }
}

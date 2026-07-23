import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { SalesOrderAdvanceReceiptService } from './sales-order-advance-receipt.service';
import { CreateSalesOrderAdvanceReceiptDto } from './dto/create-sales-order-advance-receipt.dto';
import { VerifySalesOrderAdvanceReceiptDto } from './dto/verify-sales-order-advance-receipt.dto';

@Controller('sales-order-advance-receipt')
export class SalesOrderAdvanceReceiptController {
  constructor(
    private readonly salesOrderAdvanceReceiptService: SalesOrderAdvanceReceiptService,
  ) {}

  @Post('create')
  create(@Body() data: CreateSalesOrderAdvanceReceiptDto) {
    return this.salesOrderAdvanceReceiptService.create(data);
  }

  @Patch(':id/verify')
verify(
  @Param('id') id: string,
  @Body() data: VerifySalesOrderAdvanceReceiptDto,
) {
  return this.salesOrderAdvanceReceiptService.verify(id, data);
}

  @Get()
  findAll() {
    return this.salesOrderAdvanceReceiptService.findAll();
  }
}

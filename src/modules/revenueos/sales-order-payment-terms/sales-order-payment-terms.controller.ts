import { Body, Controller, Get, Post } from '@nestjs/common';
import { SalesOrderPaymentTermsService } from './sales-order-payment-terms.service';
import { CreateSalesOrderPaymentTermDto } from './dto/create-sales-order-payment-term.dto';

@Controller('sales-order-payment-terms')
export class SalesOrderPaymentTermsController {
  constructor(
    private readonly salesOrderPaymentTermsService: SalesOrderPaymentTermsService,
  ) {}

  @Post('create')
  create(@Body() data: CreateSalesOrderPaymentTermDto) {
    return this.salesOrderPaymentTermsService.create(data);
  }

  @Get()
  findAll() {
    return this.salesOrderPaymentTermsService.findAll();
  }
}

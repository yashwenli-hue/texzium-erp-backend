import { Body, Controller, Get, Post } from '@nestjs/common';
import { SalesInvoicesService } from './sales-invoices.service';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';

@Controller('sales-invoices')
export class SalesInvoicesController {
  constructor(
    private readonly salesInvoicesService: SalesInvoicesService,
  ) {}

  @Post()
  create(@Body() body: CreateSalesInvoiceDto) {
    return this.salesInvoicesService.create(body);
  }

  @Get()
  findAll() {
    return this.salesInvoicesService.findAll();
  }
}

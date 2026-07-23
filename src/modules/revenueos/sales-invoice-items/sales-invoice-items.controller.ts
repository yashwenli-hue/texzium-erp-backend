import { Body, Controller, Post } from '@nestjs/common';
import { SalesInvoiceItemsService } from './sales-invoice-items.service';
import { CreateSalesInvoiceItemDto } from './dto/create-sales-invoice-item.dto';

@Controller('sales-invoice-items')
export class SalesInvoiceItemsController {
  constructor(
    private readonly salesInvoiceItemsService: SalesInvoiceItemsService,
  ) {}

  @Post()
  create(@Body() data: CreateSalesInvoiceItemDto) {
    return this.salesInvoiceItemsService.create(data);
  }
}

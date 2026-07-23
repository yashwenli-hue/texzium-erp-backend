import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ProformaInvoicesService } from './proforma-invoices.service';
import { CreateProformaInvoiceDto } from './dto/create-proforma-invoice.dto';

@Controller('proforma-invoices')
export class ProformaInvoicesController {
  constructor(
    private readonly proformaInvoicesService: ProformaInvoicesService,
  ) {}

  @Post()
  create(@Body() body: CreateProformaInvoiceDto) {
    return this.proformaInvoicesService.create(body);
  }

  @Get()
  findAll() {
    return this.proformaInvoicesService.findAll();
  }

  @Patch(':id/approve')
approve(@Param('id') id: string) {
  return this.proformaInvoicesService.approve(id);
}

}

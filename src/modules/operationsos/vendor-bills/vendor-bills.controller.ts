import { Body, Controller, Get, Post } from '@nestjs/common';
import { VendorBillsService } from './vendor-bills.service';
import { CreateVendorBillDto } from './dto/create-vendor-bill.dto';

@Controller('vendor-bills')
export class VendorBillsController {
  constructor(
    private readonly vendorBillsService: VendorBillsService,
  ) {}

  @Post()
  create(@Body() body: CreateVendorBillDto) {
    return this.vendorBillsService.create(body);
  }

  @Get()
  findAll() {
    return this.vendorBillsService.findAll();
  }
}

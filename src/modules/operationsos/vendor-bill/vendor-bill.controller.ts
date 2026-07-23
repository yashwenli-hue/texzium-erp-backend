import { Body, Controller, Get, Post } from '@nestjs/common';
import { VendorBillService } from './vendor-bill.service';
import { CreateVendorBillDto } from './dto/create-vendor-bill.dto';

@Controller('vendor-bill')
export class VendorBillController {
  constructor(
    private readonly vendorBillService: VendorBillService,
  ) {}

  @Post('create')
  create(@Body() data: CreateVendorBillDto) {
    return this.vendorBillService.create(data);
  }

  @Get()
  findAll() {
    return this.vendorBillService.findAll();
  }
}

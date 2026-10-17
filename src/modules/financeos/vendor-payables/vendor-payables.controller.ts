import { Body, Controller, Post } from '@nestjs/common';
import { VendorPayablesService } from './vendor-payables.service';
import { CreateVendorPayableDto } from './dto/create-vendor-payable.dto';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('vendor-payables')
export class VendorPayablesController {
  constructor(
    private readonly vendorPayablesService: VendorPayablesService,
  ) {}

  @Post('create')
  create(@Body() data: CreateVendorPayableDto) {
    return this.vendorPayablesService.create(data);
  }
}

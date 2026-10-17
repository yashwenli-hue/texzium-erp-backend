import { Body, Controller, Get, Post } from '@nestjs/common';
import { VendorLedgersService } from './vendor-ledgers.service';
import { CreateVendorLedgerDto } from './dto/create-vendor-ledger.dto';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('vendor-ledgers')
export class VendorLedgersController {
  constructor(
    private readonly vendorLedgersService: VendorLedgersService,
  ) {}

  @Post()
  create(@Body() body: CreateVendorLedgerDto) {
    return this.vendorLedgersService.create(body);
  }

  @Get()
  findAll() {
    return this.vendorLedgersService.findAll();
  }
}

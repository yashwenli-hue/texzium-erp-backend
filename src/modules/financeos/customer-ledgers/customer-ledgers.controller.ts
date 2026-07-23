import { Body, Controller, Get, Post } from '@nestjs/common';
import { CustomerLedgersService } from './customer-ledgers.service';
import { CreateCustomerLedgerDto } from './dto/create-customer-ledger.dto';

@Controller('customer-ledgers')
export class CustomerLedgersController {
  constructor(
    private readonly CustomerLedgersService: CustomerLedgersService,
  ) {}

  @Post()
  create(@Body() body: CreateCustomerLedgerDto) {
    return this.CustomerLedgersService.create(body);
  }

  @Get()
  findAll() {
    return this.CustomerLedgersService.findAll();
  }
}

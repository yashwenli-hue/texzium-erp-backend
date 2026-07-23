import { Body, Controller, Get, Post } from '@nestjs/common';
import { CustomerMasterService } from './customer-master.service';
import { CreateCustomerDto } from './dto/create-customer.dto';

@Controller('customers')
export class CustomerMasterController {
  constructor(private readonly customerService: CustomerMasterService) {}

  @Post()
  create(@Body() body: CreateCustomerDto) {
    return this.customerService.create(body);
  }

  @Get()
  findAll() {
    return this.customerService.findAll();
  }
}

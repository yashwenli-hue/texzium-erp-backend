import { Body, Controller, Get, Post } from '@nestjs/common';
import { CustomerGstService } from './customer-gst.service';
import { CreateCustomerGstDto } from './dto/create-customer-gst.dto';

@Controller('customer-gst')
export class CustomerGstController {
  constructor(private readonly customerGstService: CustomerGstService) {}

  @Post()
  create(@Body() body: CreateCustomerGstDto) {
    return this.customerGstService.create(body);
  }

  @Get()
  findAll() {
    return this.customerGstService.findAll();
  }
}

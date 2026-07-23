import { Body, Controller, Get, Post } from '@nestjs/common';
import { CompanyGstService } from './company-gst.service';
import { CreateCompanyGstDto } from './dto/create-company-gst.dto';

@Controller('company-gst')
export class CompanyGstController {
  constructor(private readonly companyGstService: CompanyGstService) {}

  @Post()
  create(@Body() body: CreateCompanyGstDto) {
    return this.companyGstService.create(body);
  }

  @Get()
  findAll() {
    return this.companyGstService.findAll();
  }
}

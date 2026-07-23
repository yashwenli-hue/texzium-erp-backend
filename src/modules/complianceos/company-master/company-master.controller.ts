import { Body, Controller, Get, Post } from '@nestjs/common';
import { CompanyMasterService } from './company-master.service';
import { CreateCompanyDto } from './dto/create-company.dto';

@Controller('companies')
export class CompanyMasterController {
  constructor(private readonly companyService: CompanyMasterService) {}

  @Post()
  create(@Body() body: CreateCompanyDto) {
    return this.companyService.create(body);
  }

  @Get()
  findAll() {
    return this.companyService.findAll();
  }
}

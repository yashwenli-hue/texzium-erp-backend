import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CommissioningService } from './commissioning.service';
import { CreateCommissioningTemplateDto } from './dto/create-commissioning-template.dto';
import { CreateCommissioningFieldDto } from './dto/create-commissioning-field.dto';
import { CreateCommissioningDto } from './dto/create-commissioning.dto';
import { CreateCommissioningResultDto } from './dto/create-commissioning-result.dto';
import { CommissioningCertificateService } from './commissioning-certificate.service';



@Controller('commissioning')
export class CommissioningController {
  constructor(
    private readonly commissioningService: CommissioningService,
    private readonly commissioningCertificateService: CommissioningCertificateService,
  ) {}

  @Post('templates')
  createTemplate(@Body() body: CreateCommissioningTemplateDto) {
    return this.commissioningService.createTemplate(body);
  }

  @Post('fields')
  createField(@Body() body: CreateCommissioningFieldDto) {
    return this.commissioningService.createField(body);
  }
  
  @Get()
  findAllCommissionings() {
    return this.commissioningService.getAllCommissionings();
  }


  @Get('templates')
  getTemplates() {
    return this.commissioningService.getTemplates();
  }

  @Post('execute')
  createCommissioning(@Body() body: CreateCommissioningDto) {
    return this.commissioningService.createCommissioning(body);
  }

  @Post('results')
  createResult(@Body() body: CreateCommissioningResultDto) {
    return this.commissioningService.createResult(body);
  }
  
  @Patch(':id/finalize')
  finalize(@Param('id') id: string) {
    return this.commissioningService.finalizeCommissioning(id);
  }

  @Post(':id/certificate')
  generateCertificate(@Param('id') id: string) {
    return this.commissioningCertificateService.generateCertificate(id);
   }


}

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationStatusDto } from './dto/update-quotation-status.dto';

@Controller('quotations')
export class QuotationsController {
  constructor(
    private readonly quotationsService: QuotationsService,
  ) {}

  @Post()
  create(@Body() body: CreateQuotationDto) {
    return this.quotationsService.create(body);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateQuotationStatusDto,
  ) {
    return this.quotationsService.updateStatus(
      id,
      body.status,
    );
  }

  @Patch(':id/revise')
  reviseQuotation(
    @Param('id') id: string,
    @Body() body: { totalAmount: number },
  ) {
    return this.quotationsService.reviseQuotation(
      id,
      body.totalAmount,
    );
  }

  @Patch(':id/approve')
  approveQuotation(
    @Param('id') id: string,
  ) {
    return this.quotationsService.approveQuotation(
      id,
    );
  }

  @Post(':id/convert')
  convertToSalesOrder(
    @Param('id') id: string,
  ) {
    return this.quotationsService.convertToSalesOrder(
      id,
    );
  }

  @Get()
  findAll() {
    return this.quotationsService.findAll();
  }
}

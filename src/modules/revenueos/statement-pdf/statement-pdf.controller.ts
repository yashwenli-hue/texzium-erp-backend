import { Controller, Get, Param } from '@nestjs/common';
import { StatementPdfService } from './statement-pdf.service';

@Controller('statement-pdf')
export class StatementPdfController {
  constructor(
    private readonly statementPdfService: StatementPdfService,
  ) {}

  @Get(':customerName')
  generate(
    @Param('customerName') customerName: string,
  ) {
    return this.statementPdfService.generate(customerName);
  }
}

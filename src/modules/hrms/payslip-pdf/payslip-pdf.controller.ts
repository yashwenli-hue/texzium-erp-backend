import { Controller, Get, Param } from '@nestjs/common';
import { PayslipPdfService } from './payslip-pdf.service';

@Controller('payslip-pdf')
export class PayslipPdfController {
  constructor(
    private readonly payslipPdfService: PayslipPdfService,
  ) {}

  @Get(':payrollId')
  generate(@Param('payrollId') payrollId: string) {
    return this.payslipPdfService.generate(payrollId);
  }
}

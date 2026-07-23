import { Module } from '@nestjs/common';
import { PayslipPdfController } from './payslip-pdf.controller';
import { PayslipPdfService } from './payslip-pdf.service';

@Module({
  controllers: [PayslipPdfController],
  providers: [PayslipPdfService],
})
export class PayslipPdfModule {}

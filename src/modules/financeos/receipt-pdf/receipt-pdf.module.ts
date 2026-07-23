import { Module } from '@nestjs/common';
import { ReceiptPdfController } from './receipt-pdf.controller';
import { ReceiptPdfService } from './receipt-pdf.service';

@Module({
  controllers: [ReceiptPdfController],
  providers: [ReceiptPdfService],
})
export class ReceiptPdfModule {}

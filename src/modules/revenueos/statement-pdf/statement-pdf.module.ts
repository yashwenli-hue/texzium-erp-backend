import { Module } from '@nestjs/common';
import { StatementPdfController } from './statement-pdf.controller';
import { StatementPdfService } from './statement-pdf.service';

@Module({
  controllers: [StatementPdfController],
  providers: [StatementPdfService],
})
export class StatementPdfModule {}

import { Module } from '@nestjs/common';
import { SalesOrderPaymentTermsController } from './sales-order-payment-terms.controller';
import { SalesOrderPaymentTermsService } from './sales-order-payment-terms.service';
import { DatabaseModule } from '../../../core/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [SalesOrderPaymentTermsController],
  providers: [SalesOrderPaymentTermsService],
})
export class SalesOrderPaymentTermsModule {}

import { Module } from '@nestjs/common';
import { PaymentCollectionsController } from './payment-collections.controller';
import { PaymentCollectionsService } from './payment-collections.service';

@Module({
  controllers: [PaymentCollectionsController],
  providers: [PaymentCollectionsService],
})
export class PaymentCollectionsModule {}

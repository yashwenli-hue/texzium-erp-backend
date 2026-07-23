import { Controller, Post, Param } from '@nestjs/common';
import { ReceiptVouchersService } from './receipt-vouchers.service';

@Controller('receipt-vouchers')
export class ReceiptVouchersController {
  constructor(
    private readonly receiptVouchersService: ReceiptVouchersService,
  ) {}

  @Post(':paymentCollectionId/generate')
  generate(
    @Param('paymentCollectionId') paymentCollectionId: string,
  ) {
    return this.receiptVouchersService.generate(
      paymentCollectionId,
    );
  }
}

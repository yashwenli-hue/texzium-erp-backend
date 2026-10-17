import { Body, Controller, Post } from '@nestjs/common';
import { RefundVouchersService } from './refund-vouchers.service';
import { CreateRefundVoucherDto } from './dto/create-refund-voucher.dto';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('refund-vouchers')
export class RefundVouchersController {
  constructor(
    private readonly refundVouchersService: RefundVouchersService,
  ) {}

  @Post('generate')
  generate(@Body() data: CreateRefundVoucherDto) {
    return this.refundVouchersService.generate(data);
  }
}

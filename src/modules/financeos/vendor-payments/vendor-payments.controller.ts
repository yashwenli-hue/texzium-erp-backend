import { Body, Controller, Post } from '@nestjs/common';
import { VendorPaymentsService } from './vendor-payments.service';
import { CreateVendorPaymentDto } from './dto/create-vendor-payment.dto';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('vendor-payments')
export class VendorPaymentsController {
  constructor(
    private readonly vendorPaymentsService: VendorPaymentsService,
  ) {}

  @Post()
  create(@Body() data: CreateVendorPaymentDto) {
    return this.vendorPaymentsService.create(data);
  }
}

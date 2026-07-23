import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { EWayBillService } from './e-way-bill.service';

@Controller('e-way-bill')
export class EWayBillController {
  constructor(
    private readonly eWayBillService: EWayBillService,
  ) {}

  @Post('generate/:salesInvoiceId')
  generate(
    @Param('salesInvoiceId') salesInvoiceId: string,
    @Body() body: {
      transporterName: string;
      vehicleNumber: string;
      distanceKm: number;
    },
  ) {
    return this.eWayBillService.generate(
      salesInvoiceId,
      body,
    );
  }

  @Get()
  findAll() {
    return this.eWayBillService.findAll();
  }
}

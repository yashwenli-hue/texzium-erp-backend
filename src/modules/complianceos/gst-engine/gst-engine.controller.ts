import { Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { GstEngineService } from './gst-engine.service';

@Controller('gst-engine')
export class GstEngineController {
  constructor(private readonly gstEngineService: GstEngineService) {}

  @Post(':salesInvoiceId/generate-irn')
  generateIRN(@Param('salesInvoiceId') salesInvoiceId: string) {
    return this.gstEngineService.generateIRN(salesInvoiceId);
  }

  @Patch(':gstRegistryId/generate-eway')
  generateEWayBill(@Param('gstRegistryId') gstRegistryId: string) {
    return this.gstEngineService.generateEWayBill(gstRegistryId);
  }

  @Get()
  findAll() {
    return this.gstEngineService.findAll();
  }
}

import { Controller, Get } from '@nestjs/common';
import { GstReturnsService } from './gst-returns.service';

@Controller('gst-returns')
export class GstReturnsController {
  constructor(private readonly gstReturnsService: GstReturnsService) {}

  @Get('gstr1')
  getGstr1() {
    return this.gstReturnsService.generateGstr1();
  }

  @Get('gstr3b')
  getGstr3b() {
    return this.gstReturnsService.generateGstr3b();
  }

  @Get('hsn-summary')
  getHsnSummary() {
    return this.gstReturnsService.generateHsnSummary();
  }
}

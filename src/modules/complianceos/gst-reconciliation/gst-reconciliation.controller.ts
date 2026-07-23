import { Controller, Get } from '@nestjs/common';
import { GstReconciliationService } from './gst-reconciliation.service';

@Controller('gst-reconciliation')
export class GstReconciliationController {
  constructor(
    private readonly gstReconciliationService: GstReconciliationService,
  ) {}

  @Get()
  reconcile() {
    return this.gstReconciliationService.reconcile();
  }
}

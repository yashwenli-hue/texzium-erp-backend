import { Controller, Get } from '@nestjs/common';
import { GstReconciliationService } from './gst-reconciliation.service';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
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

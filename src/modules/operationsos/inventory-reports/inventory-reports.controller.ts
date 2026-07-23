import { Controller, Get } from '@nestjs/common';
import { InventoryReportsService } from './inventory-reports.service';

@Controller('inventory-reports')
export class InventoryReportsController {
  constructor(
    private readonly inventoryReportsService: InventoryReportsService,
  ) {}

  @Get('summary')
  summary() {
    return this.inventoryReportsService.summary();
  }

  @Get('low-stock')
  lowStock() {
    return this.inventoryReportsService.lowStock();
  }

  @Get('dead-stock')
  deadStock() {
    return this.inventoryReportsService.deadStock();
  }

  @Get('fast-moving')
  fastMoving() {
    return this.inventoryReportsService.fastMoving();
  }

  @Get('slow-moving')
slowMoving() {
  return this.inventoryReportsService.slowMoving();
}

@Get('warehouse-utilization')
warehouseUtilization() {
  return this.inventoryReportsService.warehouseUtilization();
}

@Get('stock-aging')
stockAging() {
  return this.inventoryReportsService.stockAging();
}

@Get('reorder-alerts')
reorderAlerts() {
  return this.inventoryReportsService.reorderAlerts();
}
}

import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { VIEW_ALL_PERMISSION } from '../record-scope/record-scope';
import { SalesReportsService } from './sales-reports.service';

// Company-wide figures (every customer, every salesperson): only for people who may see
// every record (revenue.view.all). They cannot be cut down to one person's scope.
@Controller('sales-reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(VIEW_ALL_PERMISSION)
export class SalesReportsController {
  constructor(
    private readonly salesReportsService: SalesReportsService,
  ) {}

  @Get('funnel')
  funnel() {
    return this.salesReportsService.funnel();
  }

  @Get('revenue-summary')
  revenueSummary() {
    return this.salesReportsService.revenueSummary();
  }

  @Get('customer-revenue')
  customerRevenue() {
    return this.salesReportsService.customerRevenue();
  }

  @Get('lead-conversion')
leadConversion() {
  return this.salesReportsService.leadConversion();
}

@Get('quotation-conversion')
quotationConversion() {
  return this.salesReportsService.quotationConversion();
}

@Get('lost-opportunities')
lostOpportunities() {
  return this.salesReportsService.lostOpportunities();
}

@Get('salesperson-performance')
salespersonPerformance() {
  return this.salesReportsService.salespersonPerformance();
}

@Get('top-products')
topProducts() {
  return this.salesReportsService.topProducts();
}

@Get('product-revenue')
productRevenue() {
  return this.salesReportsService.productRevenue();
}

@Get('product-quantity')
productQuantity() {
  return this.salesReportsService.productQuantity();
}

@Get('hsn-revenue')
hsnRevenue() {
  return this.salesReportsService.hsnRevenue();
}

@Get('category-revenue')
categoryRevenue() {
  return this.salesReportsService.categoryRevenue();
}

}

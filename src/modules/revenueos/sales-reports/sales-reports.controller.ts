import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { VIEW_ALL_PERMISSION } from '../record-scope/record-scope';
import { FinanceRecords } from '../record-scope/finance-visibility.guard';
import { SalesReportsService } from './sales-reports.service';

// Company-wide figures (every customer, every salesperson): they cannot be cut down to one
// person's scope, so each needs a company-wide permission (D3, 2026-10-17):
//   pipeline reports (funnel, lead and quotation conversion, lost opportunities) count or
//   list leads, opportunities and quotations: revenue.view.all
//   money reports (revenue, customer / product / HSN / category revenue, quantities,
//   performance) add up sales invoices: finance visibility - finance.view.all, or
//   revenue.view.all which includes it - so Finance does not need to see every lead.
@Controller('sales-reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesReportsController {
  constructor(
    private readonly salesReportsService: SalesReportsService,
  ) {}

  @Get('funnel')
  @Permissions(VIEW_ALL_PERMISSION)
  funnel() {
    return this.salesReportsService.funnel();
  }

  @Get('revenue-summary')
  @FinanceRecords()
  revenueSummary() {
    return this.salesReportsService.revenueSummary();
  }

  @Get('customer-revenue')
  @FinanceRecords()
  customerRevenue() {
    return this.salesReportsService.customerRevenue();
  }

  @Get('lead-conversion')
  @Permissions(VIEW_ALL_PERMISSION)
leadConversion() {
  return this.salesReportsService.leadConversion();
}

@Get('quotation-conversion')
@Permissions(VIEW_ALL_PERMISSION)
quotationConversion() {
  return this.salesReportsService.quotationConversion();
}

@Get('lost-opportunities')
@Permissions(VIEW_ALL_PERMISSION)
lostOpportunities() {
  return this.salesReportsService.lostOpportunities();
}

@Get('salesperson-performance')
@FinanceRecords()
salespersonPerformance() {
  return this.salesReportsService.salespersonPerformance();
}

@Get('top-products')
@FinanceRecords()
topProducts() {
  return this.salesReportsService.topProducts();
}

@Get('product-revenue')
@FinanceRecords()
productRevenue() {
  return this.salesReportsService.productRevenue();
}

@Get('product-quantity')
@FinanceRecords()
productQuantity() {
  return this.salesReportsService.productQuantity();
}

@Get('hsn-revenue')
@FinanceRecords()
hsnRevenue() {
  return this.salesReportsService.hsnRevenue();
}

@Get('category-revenue')
@FinanceRecords()
categoryRevenue() {
  return this.salesReportsService.categoryRevenue();
}

}

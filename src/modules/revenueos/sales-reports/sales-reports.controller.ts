import { Controller, Get } from '@nestjs/common';
import { SalesReportsService } from './sales-reports.service';

@Controller('sales-reports')
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

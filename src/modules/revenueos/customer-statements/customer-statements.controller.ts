import { Controller, Get, Param } from '@nestjs/common';
import { CustomerStatementsService } from './customer-statements.service';

@Controller('customer-statements')
export class CustomerStatementsController {
  constructor(
    private readonly customerStatementsService: CustomerStatementsService,
  ) {}

  @Get(':customerName')
  getStatement(
    @Param('customerName') customerName: string,
  ) {
    return this.customerStatementsService.getStatement(
      customerName,
    );
  }
}

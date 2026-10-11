import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CustomerStatementsService } from './customer-statements.service';
import { StatementQueryDto } from './dto/statement-query.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

// A customer's ledger statement, by customer id. Needs collections.view; only reads.
@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomerStatementsController {
  constructor(
    private readonly customerStatementsService: CustomerStatementsService,
  ) {}

  @Get(':id/statement')
  @Permissions('collections.view')
  statement(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: StatementQueryDto,
  ) {
    return this.customerStatementsService.statement(id, query);
  }
}

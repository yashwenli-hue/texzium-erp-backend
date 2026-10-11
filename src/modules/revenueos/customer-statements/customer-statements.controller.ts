import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { CustomerStatementsService } from './customer-statements.service';
import { StatementQueryDto } from './dto/statement-query.dto';
import { calendarDay } from './statement-calculator';
import { renderStatementPdf } from './statement-pdf.renderer';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

// A customer's ledger statement, by customer id, as JSON or as a PDF built in memory.
// Both need collections.view; both only read.
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

  @Get(':id/statement.pdf')
  @Permissions('collections.view')
  async statementPdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: StatementQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const statement = await this.customerStatementsService.statement(id, query);
    const pdf = await renderStatementPdf(statement);
    const name = [
      'statement',
      statement.customer.customerCode,
      statement.period.from ?? 'all',
      statement.period.to ?? calendarDay(new Date(statement.generatedAt)),
    ]
      .join('-')
      .replace(/[^A-Za-z0-9._-]/g, '_');

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');

    return new StreamableFile(pdf, {
      type: 'application/pdf',
      length: pdf.length,
      disposition: `attachment; filename="${name}.pdf"`,
    });
  }
}

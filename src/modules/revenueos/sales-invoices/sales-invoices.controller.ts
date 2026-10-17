import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Response } from 'express';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { SalesInvoicesService } from './sales-invoices.service';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';
import { renderDocumentPdf } from '../../../core/documents/document-renderer';
import { pdfAttachment } from '../../../core/documents/document-response';
import { safeFileName } from '../../../core/documents/document-text';
import { invoiceDocument } from './invoice-document';
import {
  RecordScopeGuard,
  ScopedRecord,
} from '../record-scope/record-scope.guard';
import { financeScopeOf } from '../record-scope/record-scope';

// Issuing an invoice needs invoices.create; reading invoices needs
// invoices.view (both were open to any signed-in user before).
@Controller('sales-invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class SalesInvoicesController {
  constructor(private readonly salesInvoicesService: SalesInvoicesService) {}

  @Post()
  @ScopedRecord('salesOrder', 'body.salesOrderId', { finance: true })
  @Permissions('invoices.create')
  create(@Body() body: CreateSalesInvoiceDto) {
    return this.salesInvoicesService.create(body);
  }

  @Get()
  @Permissions('invoices.view')
  findAll(@Req() req: { user?: { id?: string; permissions?: unknown } }) {
    return this.salesInvoicesService.findAll(financeScopeOf(req.user));
  }

  // The tax invoice as a PDF, built in memory. Needs invoices.view AND
  // invoices.document.view: the second is created but granted to no role
  // until the accountant confirms e-invoicing applicability, so the tax
  // invoice cannot be printed before then (see
  // 20261016_tax_invoice_document_permission.sql). Refused (409) for an
  // invoice that lacks what a tax invoice must carry.
  @Get(':id/document.pdf')
  @ScopedRecord('salesInvoice', 'params.id')
  @Permissions('invoices.view', 'invoices.document.view')
  async document(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const data = await this.salesInvoicesService.documentData(id);
    const pdf = await renderDocumentPdf(invoiceDocument(data));
    return pdfAttachment(
      res,
      pdf,
      safeFileName(['invoice', data.invoice.invoiceNumber ?? id], 'pdf'),
    );
  }
}

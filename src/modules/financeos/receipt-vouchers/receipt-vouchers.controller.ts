import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import {
  RecordScopeGuard,
  ScopedRecord,
} from '../../revenueos/record-scope/record-scope.guard';
import { ReceiptVouchersService } from './receipt-vouchers.service';
import { ListReceiptVouchersQueryDto } from './dto/list-receipt-vouchers-query.dto';
import { renderDocumentPdf } from '../../../core/documents/document-renderer';
import { pdfAttachment } from '../../../core/documents/document-response';
import { safeFileName } from '../../../core/documents/document-text';
import { receiptDocument } from './receipt-document';

// Generating a receipt needs collections.record (the permission that records
// the payment); reading receipts needs collections.view. Both also need the payment,
// invoice or receipt to be in the caller's finance scope (404 otherwise).
@Controller('receipt-vouchers')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class ReceiptVouchersController {
  constructor(
    private readonly receiptVouchersService: ReceiptVouchersService,
  ) {}

  @Post(':paymentCollectionId/generate')
  @Permissions('collections.record')
  @ScopedRecord('paymentCollection', 'params.paymentCollectionId')
  generate(
    @Param('paymentCollectionId', new ParseUUIDPipe())
    paymentCollectionId: string,
  ) {
    return this.receiptVouchersService.generate(paymentCollectionId);
  }

  @Get()
  @Permissions('collections.view')
  @ScopedRecord('salesInvoice', 'query.salesInvoiceId')
  list(@Query() query: ListReceiptVouchersQueryDto) {
    return this.receiptVouchersService.listForInvoice(query.salesInvoiceId);
  }

  // The receipt as a PDF, built in memory (collections.view). Nothing is
  // written to disk and no server path is returned.
  @Get(':id/document.pdf')
  @Permissions('collections.view')
  @ScopedRecord('receiptVoucher', 'params.id')
  async document(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const data = await this.receiptVouchersService.documentData(id);
    const pdf = await renderDocumentPdf(receiptDocument(data));
    return pdfAttachment(
      res,
      pdf,
      safeFileName(['receipt', data.receipt.receiptNumber ?? id], 'pdf'),
    );
  }
}

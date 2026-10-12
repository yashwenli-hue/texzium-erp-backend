import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ProformaInvoicesService } from './proforma-invoices.service';
import { CreateProformaInvoiceDto } from './dto/create-proforma-invoice.dto';
import { ApproveProformaInvoiceDto } from './dto/approve-proforma-invoice.dto';
import { CancelProformaInvoiceDto } from './dto/cancel-proforma-invoice.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { renderDocumentPdf } from '../../../core/documents/document-renderer';
import { pdfAttachment } from '../../../core/documents/document-response';
import { safeFileName } from '../../../core/documents/document-text';
import { proformaDocument } from './proforma-document';

type AuthenticatedRequest = { user?: { id?: string } };

@Controller('proforma-invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProformaInvoicesController {
  constructor(
    private readonly proformaInvoicesService: ProformaInvoicesService,
  ) {}

  @Post()
  @Permissions('proformas.create')
  create(
    @Body() body: CreateProformaInvoiceDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.proformaInvoicesService.create(body, req.user?.id);
  }

  @Get()
  @Permissions('proformas.view')
  findAll() {
    return this.proformaInvoicesService.findAll();
  }

  // The Proforma Invoice as a PDF, built in memory (proformas.view).
  @Get(':id/document.pdf')
  @Permissions('proformas.view')
  async document(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const data = await this.proformaInvoicesService.documentData(id);
    const pdf = await renderDocumentPdf(proformaDocument(data));
    return pdfAttachment(
      res,
      pdf,
      safeFileName(
        ['proforma', data.proforma.proformaNumber ?? id.slice(0, 8)],
        'pdf',
      ),
    );
  }

  @Get(':id/events')
  @Permissions('proformas.view')
  findEvents(@Param('id') id: string) {
    return this.proformaInvoicesService.findEvents(id);
  }

  // The actor is the signed-in user.
  @Patch(':id/approve')
  @Permissions('proformas.approve')
  approve(
    @Param('id') id: string,
    @Body() body: ApproveProformaInvoiceDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.proformaInvoicesService.approve(id, req.user?.id, body);
  }

  @Patch(':id/cancel')
  @Permissions('proformas.cancel')
  cancel(
    @Param('id') id: string,
    @Body() body: CancelProformaInvoiceDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.proformaInvoicesService.cancel(id, req.user?.id, body);
  }
}

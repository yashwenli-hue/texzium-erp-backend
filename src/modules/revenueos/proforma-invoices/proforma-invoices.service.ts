import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateProformaInvoiceDto } from './dto/create-proforma-invoice.dto';

@Injectable()
export class ProformaInvoicesService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateProformaInvoiceDto) {
    return this.prisma.proformaInvoice.create({
      data: {
        quotationId: data.quotationId,
        issueDate: new Date(data.issueDate),
        totalAmount: data.totalAmount,
        validityDate: data.validityDate ? new Date(data.validityDate) : null,
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.proformaInvoice.findMany({
      include: {
        quotation: true,
      },
    });
  }
  async approve(id: string) {
  return this.prisma.proformaInvoice.update({
    where: { id },
    data: {
      customerStatus: 'APPROVED',
    },
  });
}

}

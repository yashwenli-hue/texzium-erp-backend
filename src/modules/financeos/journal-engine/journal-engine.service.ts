import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';

@Injectable()
export class JournalEngineService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateJournalEntryDto) {
    const financialYear =
      await this.prisma.financialYear.findFirst({
        orderBy: {
          createdAt: 'desc',
        },
      });

    return this.prisma.journalEntry.create({
      data: {
        voucherNumber: data.voucherNumber,
        voucherDate: new Date(data.entryDate),
        narration: data.remarks,
        financialYearId: financialYear!.id,
      },
    });
  }

  async findAll() {
    return this.prisma.journalEntry.findMany({
      include: {
        journalLines: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';

@Injectable()
export class DocumentNumberGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(
    module: string,
    documentType: string,
  ): Promise<string> {

    // Find Active Number Series
    const series = await this.prisma.documentNumberSeries.findFirst({
      where: {
        module,
        documentType,
        isActive: true,
      },
    });

    if (!series) {
      throw new Error(
        `No active number series found for ${module} - ${documentType}`,
      );
    }

    // Increment Counter
    const updatedSeries =
      await this.prisma.documentNumberSeries.update({
        where: {
          id: series.id,
        },
        data: {
          currentNumber: {
            increment: 1,
          },
        },
      });

    const nextNumber = updatedSeries.currentNumber;

    // Padding
    const sequence = nextNumber
      .toString()
      .padStart(updatedSeries.padding, '0');

    // Financial Year
    const fy =
      updatedSeries.financialYearFormat ?? '2026-27';

    // Prefix
    const prefix =
      updatedSeries.prefix ?? '';

    // Document Code
    const doc =
      updatedSeries.documentCode ?? '';

    // Format
    const format =
      updatedSeries.format ??
      '{PREFIX}/{DOC}/{FY}/{SEQ}';

    // Build Final Number
    const documentNumber = format
      .replace('{PREFIX}', prefix)
      .replace('{DOC}', doc)
      .replace('{FY}', fy)
      .replace('{SEQ}', sequence);

    return documentNumber;
  }
}

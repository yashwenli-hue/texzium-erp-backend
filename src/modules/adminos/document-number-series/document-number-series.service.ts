import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

import { CreateDocumentNumberSeriesDto } from './dto/create-document-number-series.dto';
import { UpdateDocumentNumberSeriesDto } from './dto/update-document-number-series.dto';

@Injectable()
export class DocumentNumberSeriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateDocumentNumberSeriesDto) {
    return this.prisma.documentNumberSeries.create({
      data,
    });
  }

  async findAll() {
    return this.prisma.documentNumberSeries.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const series = await this.prisma.documentNumberSeries.findUnique({
      where: {
        id,
      },
    });

    if (!series) {
      throw new NotFoundException('Document Number Series not found');
    }

    return series;
  }

  async update(
    id: string,
    data: UpdateDocumentNumberSeriesDto,
  ) {
    await this.findOne(id);

    return this.prisma.documentNumberSeries.update({
      where: {
        id,
      },
      data,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.documentNumberSeries.update({
      where: {
        id,
      },
      data: {
        isActive: false,
      },
    });
  }
}

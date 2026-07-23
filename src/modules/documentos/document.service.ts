import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';

@Injectable()
export class DocumentService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    documentName: string;
    documentType: string;
    moduleName: string;
    referenceId: string;
    filePath: string;
    remarks?: string;
  }) {
    return this.prisma.document.create({
      data,
    });
  }

  async findAll() {
    return this.prisma.document.findMany();
  }

  async findById(id: string) {
  const document = await this.prisma.document.findUnique({
    where: { id },
  });

  if (!document) {
    throw new Error('Document not found');
  }

  return document;
}


}

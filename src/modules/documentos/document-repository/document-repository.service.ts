import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateDocumentDto } from './dto/create-document.dto';

@Injectable()
export class DocumentRepositoryService {
  constructor(private prisma: PrismaService) {}

  async upload(data: CreateDocumentDto) {
    return this.prisma.document.create({
      data,
    });
  }

  async findAll() {
    return this.prisma.document.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findByModule(moduleName: string) {
    return this.prisma.document.findMany({
      where: { moduleName },
    });
  }

  async findByReference(referenceId: string) {
    return this.prisma.document.findMany({
      where: { referenceId },
    });
  }
}

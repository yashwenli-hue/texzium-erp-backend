import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateLeadSourceDto } from './dto/create-lead-source.dto';

@Injectable()
export class LeadSourcesService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateLeadSourceDto) {
    return this.prisma.leadSource.create({
      data,
    });
  }

  async findAll() {
    return this.prisma.leadSource.findMany();
  }
}

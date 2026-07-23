import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';

@Injectable()
export class WorkflowEngineService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateWorkflowDto) {
    return this.prisma.workflow.create({
      data: {
        module: data.module,
        name: data.name,
        description: data.description,
      },
    });
  }

  async findAll() {
    return this.prisma.workflow.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateApprovalDto } from './dto/create-approval.dto';
import { ApproveDto } from './dto/approve.dto';

@Injectable()
export class ApprovalService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateApprovalDto) {
    return this.prisma.approval.create({
      data: {
        module: data.module,
        referenceId: data.referenceId,
        level: data.level,
        status: 'PENDING',
      },
    });
  }

  async approve(id: string, data: ApproveDto) {
    const approval = await this.prisma.approval.update({
      where: { id },
      data: {
        approvedBy: data.approvedBy,
        status: data.status,
      },
    });

    // Auto-create next approval level
    if (
      approval.module === 'SalesOrder' &&
      approval.level === 1 &&
      approval.status === 'APPROVED'
    ) {
      await this.prisma.approval.create({
        data: {
          module: 'SalesOrder',
          referenceId: approval.referenceId,
          level: 2,
          status: 'PENDING',
        },
      });
    }

    return approval;
  }

  async findAll() {
    return this.prisma.approval.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}

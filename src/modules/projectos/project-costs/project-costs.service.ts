import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateProjectCostDto } from './dto/create-project-cost.dto';

@Injectable()
export class ProjectCostsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateProjectCostDto) {
    return this.prisma.projectCost.create({
      data: {
        projectId: data.projectId,
        costType: data.costType,
        description: data.description,
        amount: data.amount,
      },
    });
  }

  async findAll() {
    return this.prisma.projectCost.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findByProject(projectId: string) {
    return this.prisma.projectCost.findMany({
      where: {
        projectId,
      },
    });
  }

  async summary(projectId: string) {
    const costs =
      await this.prisma.projectCost.findMany({
        where: {
          projectId,
        },
      });

    const totalCost =
      costs.reduce(
        (sum, item) => sum + item.amount,
        0,
      );

    const project =
      await this.prisma.project.findUnique({
        where: {
          id: projectId,
        },
      });

    return {
      budgetAmount: project?.budgetAmount || 0,
      totalCost,
      remainingBudget:
        (project?.budgetAmount || 0) - totalCost,
    };
  }
}

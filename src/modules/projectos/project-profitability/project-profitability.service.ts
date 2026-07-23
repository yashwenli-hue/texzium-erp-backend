import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class ProjectProfitabilityService {
  constructor(private prisma: PrismaService) {}

  async summary(projectId: string) {
    const project =
      await this.prisma.project.findUnique({
        where: { id: projectId },
      });

    const costs =
      await this.prisma.projectCost.findMany({
        where: { projectId },
      });

    const billings =
      await this.prisma.projectBilling.findMany({
        where: { projectId },
      });

    const totalCost =
      costs.reduce(
        (sum, item) => sum + item.amount,
        0,
      );

    const totalRevenue =
      billings.reduce(
        (sum, item) => sum + item.billingAmount,
        0,
      );

    const profit =
      totalRevenue - totalCost;

    const margin =
      totalRevenue > 0
        ? ((profit / totalRevenue) * 100).toFixed(2) + '%'
        : '0%';

    return {
      projectCode: project?.projectCode,
      budgetAmount: project?.budgetAmount,
      totalRevenue,
      totalCost,
      profit,
      margin,
      budgetRemaining:
        (project?.budgetAmount || 0) - totalCost,
    };
  }
}

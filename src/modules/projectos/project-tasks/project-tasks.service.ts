import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateProjectTaskDto } from './dto/create-project-task.dto';

@Injectable()
export class ProjectTasksService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateProjectTaskDto) {
    return this.prisma.projectTask.create({
      data: {
        projectId: data.projectId,
        taskName: data.taskName,
        assignedToId: data.assignedToId,
        startDate: new Date(data.startDate),
        endDate: data.endDate
          ? new Date(data.endDate)
          : null,
      },
    });
  }

  async findAll() {
    return this.prisma.projectTask.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findByProject(projectId: string) {
    return this.prisma.projectTask.findMany({
      where: {
        projectId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async updateProgress(id: string, progress: number) {
    return this.prisma.projectTask.update({
      where: { id },
      data: {
        progress,
        status:
          progress >= 100
            ? 'COMPLETED'
            : 'IN_PROGRESS',
      },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateEngineerVisitDto } from './dto/create-engineer-visit.dto';

@Injectable()
export class EngineerVisitsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateEngineerVisitDto) {
    const ticket = await this.prisma.serviceTicket.findUnique({
      where: { id: data.serviceTicketId },
    });

    if (!ticket) {
      throw new Error('Service Ticket not found');
    }

    return this.prisma.engineerVisit.create({
      data: {
        serviceTicketId: data.serviceTicketId,
        visitDate: new Date(data.visitDate),
        engineerName: data.engineerName,
        workDone: data.workDone,
        partsUsed: data.partsUsed,
        timeSpentHours: data.timeSpentHours,
        travelExpense: data.travelExpense || 0,
        findings: data.findings,
        nextAction: data.nextAction,
      },
    });
  }

  async findAll() {
    return this.prisma.engineerVisit.findMany({
      include: {
        serviceTicket: true,
      },
    });
  }
}

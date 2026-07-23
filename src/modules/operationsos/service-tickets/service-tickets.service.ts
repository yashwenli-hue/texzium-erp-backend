import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateServiceTicketDto } from './dto/create-service-ticket.dto';

@Injectable()
export class ServiceTicketsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateServiceTicketDto) {
    const warranty = await this.prisma.warranty.findUnique({
      where: { id: data.warrantyId },
    });

    if (!warranty) {
      throw new Error('Warranty record not found');
    }

    if (warranty.status !== 'ACTIVE') {
      throw new Error('Warranty inactive. Service not allowed');
    }

    return this.prisma.serviceTicket.create({
      data: {
        warrantyId: data.warrantyId,
        complaintTitle: data.complaintTitle,
        complaintDetail: data.complaintDetail,
        priority: data.priority || 'NORMAL',
        assignedTo: data.assignedTo,
      },
    });
  }
  
  async closeTicket(
  id: string,
  status: string,
  resolutionNotes: string,
) {
  return this.prisma.serviceTicket.update({
    where: { id },
    data: {
      status,
      resolutionNotes,
    },
  });
}
 
  async assignEngineer(
  id: string,
  engineerName: string,
) {
  return this.prisma.serviceTicket.update({
    where: { id },
    data: {
      assignedTo: engineerName,
      status: 'ASSIGNED',
    },
  });
}

async updateStatus(
  id: string,
  status: string,
) {
  return this.prisma.serviceTicket.update({
    where: { id },
    data: {
      status,
    },
  });
}


  async findAll() {
    return this.prisma.serviceTicket.findMany({
      include: {
        warranty: true,
      },
    });
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service';
import { CreateFollowupDto } from './dto/create-followup.dto';

@Injectable()
export class LeadFollowupsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateFollowupDto) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: data.leadId },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const followup = await tx.leadFollowup.create({
        data: {
          leadId: data.leadId,
          followupDate: new Date(data.followupDate),
          remarks: data.remarks,
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: data.leadId,
          action: 'FOLLOWUP_CREATED',
          remarks: data.remarks,
        },
      });

      return followup;
    });
  }

  async findAll() {
    return this.prisma.leadFollowup.findMany({
      include: {
        lead: true,
        completedBy: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            email: true,
            phone: true,
            status: true,
            roleId: true,
          },
        },
      },
      orderBy: {
        followupDate: 'asc',
      },
    });
  }

  async findByLead(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    return this.prisma.leadFollowup.findMany({
      where: { leadId },
      include: {
        lead: true,
        completedBy: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            email: true,
            phone: true,
            status: true,
            roleId: true,
          },
        },
      },
      orderBy: {
        followupDate: 'asc',
      },
    });
  }

  async completeFollowup(id: string, userId: string) {
    const followup = await this.prisma.leadFollowup.findUnique({
      where: { id },
    });

    if (!followup) {
      throw new NotFoundException('Follow-up not found');
    }

    if (followup.status === 'COMPLETED') {
      throw new BadRequestException(
        'Follow-up is already completed',
      );
    }

    if (followup.status === 'CANCELLED') {
      throw new BadRequestException(
        'Cancelled follow-up cannot be completed',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedFollowup = await tx.leadFollowup.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedById: userId,
        },
        include: {
          lead: true,
          completedBy: {
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
              email: true,
              phone: true,
              status: true,
              roleId: true,
            },
          },
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: followup.leadId,
          action: 'FOLLOWUP_COMPLETED',
          remarks: 'Follow-up completed',
        },
      });

      return updatedFollowup;
    });
  }

  async rescheduleFollowup(
    id: string,
    followupDate: string,
  ) {
    const followup = await this.prisma.leadFollowup.findUnique({
      where: { id },
    });

    if (!followup) {
      throw new NotFoundException('Follow-up not found');
    }

    if (followup.status === 'COMPLETED') {
      throw new BadRequestException(
        'Completed follow-up cannot be rescheduled',
      );
    }

    if (followup.status === 'CANCELLED') {
      throw new BadRequestException(
        'Cancelled follow-up cannot be rescheduled',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedFollowup = await tx.leadFollowup.update({
        where: { id },
        data: {
          followupDate: new Date(followupDate),
          status: 'PENDING',
        },
        include: {
          lead: true,
          completedBy: {
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
              email: true,
              phone: true,
              status: true,
              roleId: true,
            },
          },
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: followup.leadId,
          action: 'FOLLOWUP_RESCHEDULED',
          remarks: `Follow-up rescheduled to ${followupDate}`,
        },
      });

      return updatedFollowup;
    });
  }

  async cancelFollowup(id: string) {
    const followup = await this.prisma.leadFollowup.findUnique({
      where: { id },
    });

    if (!followup) {
      throw new NotFoundException('Follow-up not found');
    }

    if (followup.status === 'COMPLETED') {
      throw new BadRequestException(
        'Completed follow-up cannot be cancelled',
      );
    }

    if (followup.status === 'CANCELLED') {
      throw new BadRequestException(
        'Follow-up is already cancelled',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedFollowup = await tx.leadFollowup.update({
        where: { id },
        data: {
          status: 'CANCELLED',
        },
        include: {
          lead: true,
          completedBy: {
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
              email: true,
              phone: true,
              status: true,
              roleId: true,
            },
          },
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: followup.leadId,
          action: 'FOLLOWUP_CANCELLED',
          remarks: 'Follow-up cancelled',
        },
      });

      return updatedFollowup;
    });
  }
}

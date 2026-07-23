import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateFollowupDto } from './dto/create-followup.dto';

@Injectable()
export class LeadFollowupsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateFollowupDto) {
    const followup = await this.prisma.leadFollowup.create({
      data: {
        leadId: data.leadId,
        followupDate: new Date(data.followupDate),
        remarks: data.remarks,
      },
    });

    await this.prisma.leadTimeline.create({
      data: {
        leadId: data.leadId,
        action: 'FOLLOWUP_CREATED',
        remarks: data.remarks,
      },
    });

    return followup;
  }

  async findAll() {
    return this.prisma.leadFollowup.findMany({
      include: {
        lead: true,
      },
    });
  }

  async findByLead(leadId: string) {
  return this.prisma.leadFollowup.findMany({
    where: {
      leadId,
    },
    include: {
      lead: true,
    },
  });
}

async completeFollowup(id: string) {
  return this.prisma.leadTimeline.create({
    data: {
      leadId: (
        await this.prisma.leadFollowup.findUnique({
          where: { id },
        })
      )?.leadId!,
      action: 'FOLLOWUP_COMPLETED',
      remarks: 'Follow-up completed',
    },
  });
}

async rescheduleFollowup(
  id: string,
  followupDate: string,
) {
  return this.prisma.leadFollowup.update({
    where: {
      id,
    },
    data: {
      followupDate: new Date(followupDate),
    },
  });
}


}


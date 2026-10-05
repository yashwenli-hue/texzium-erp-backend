import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { LEAD_HISTORY_INCLUDE } from '../leads/lead-history.include';
import { lockActiveLeadForWrite } from '../leads/lead-lifecycle';

@Injectable()
export class OpportunitiesService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateOpportunityDto) {
    return this.prisma.$transaction(async (tx) => {
      // An opportunity blocks deactivation, so it must not be created while
      // the lead is being deactivated (and vice versa).
      await lockActiveLeadForWrite(tx, data.leadId);

      const opportunity = await tx.opportunity.create({
        data: {
          leadId: data.leadId,
          title: data.title,
          expectedValue: data.expectedValue,
          probability: data.probability,
          expectedCloseDate: new Date(data.expectedCloseDate),
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: data.leadId,
          action: 'OPPORTUNITY_CREATED',
          remarks: `Opportunity created: ${data.title}`,
        },
      });

      return opportunity;
    });
  }

  async findAll() {
    return this.prisma.opportunity.findMany({
      include: {
        lead: true,
      },
    });
  }

  async findOne(id: string) {
    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id },
      include: {
        lead: {
          include: {
            source: true,
            assignedTo: {
              select: {
                id: true,
                fullName: true,
              },
            },
            ...LEAD_HISTORY_INCLUDE,
            followups: {
              orderBy: {
                followupDate: 'asc',
              },
            },
          },
        },
      },
    });

    if (!opportunity) {
      throw new NotFoundException('Opportunity not found.');
    }

    return opportunity;
  }
}

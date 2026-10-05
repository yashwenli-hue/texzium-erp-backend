import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';

@Injectable()
export class OpportunitiesService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateOpportunityDto) {
    const opportunity = await this.prisma.opportunity.create({
      data: {
        leadId: data.leadId,
        title: data.title,
        expectedValue: data.expectedValue,
        probability: data.probability,
        expectedCloseDate: new Date(data.expectedCloseDate),
      },
    });

    await this.prisma.leadTimeline.create({
      data: {
        leadId: data.leadId,
        action: 'OPPORTUNITY_CREATED',
        remarks: `Opportunity created: ${data.title}`,
      },
    });

    return opportunity;
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
            notes: true,
            timelines: {
              orderBy: {
                createdAt: 'desc',
              },
            },
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

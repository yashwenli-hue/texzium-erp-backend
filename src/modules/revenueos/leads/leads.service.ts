import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service';

import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async create(data: CreateLeadDto) {
    const source =
      await this.prisma.leadSource.findUnique({
        where: {
          id: data.sourceId,
        },
      });

    if (!source) {
      throw new NotFoundException(
        'Lead source not found.',
      );
    }

    const lead = await this.prisma.lead.create({
      data: {
        leadCode: data.leadCode,
        customerName: data.customerName,
        companyName: data.companyName,
        email: data.email,
        phone: data.phone,
        alternatePhone: data.alternatePhone,
        sourceId: data.sourceId,
      },
      include: {
        source: true,
        assignedTo: true,
      },
    });

    await this.prisma.leadTimeline.create({
      data: {
        leadId: lead.id,
        action: 'LEAD_CREATED',
        remarks: 'Lead created manually.',
      },
    });

    return lead;
  }

  async findAll() {
    return this.prisma.lead.findMany({
      include: {
        source: true,
        assignedTo: true,
        followups: true,
        opportunities: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const lead =
      await this.prisma.lead.findUnique({
        where: {
          id,
        },
        include: {
          source: true,
          assignedTo: true,
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
          opportunities: true,
        },
      });

    if (!lead) {
      throw new NotFoundException(
        'Lead not found.',
      );
    }

    return lead;
  }

  async update(
    id: string,
    data: UpdateLeadDto,
  ) {
    const existing =
      await this.prisma.lead.findUnique({
        where: {
          id,
        },
      });

    if (!existing) {
      throw new NotFoundException(
        'Lead not found.',
      );
    }

    if (data.sourceId) {
      const source =
        await this.prisma.leadSource.findUnique({
          where: {
            id: data.sourceId,
          },
        });

      if (!source) {
        throw new NotFoundException(
          'Lead source not found.',
        );
      }
    }

    const lead =
      await this.prisma.lead.update({
        where: {
          id,
        },
        data,
        include: {
          source: true,
          assignedTo: true,
        },
      });

    await this.prisma.leadTimeline.create({
      data: {
        leadId: id,
        action: 'LEAD_UPDATED',
        remarks: 'Lead information updated.',
      },
    });

    return lead;
  }
}

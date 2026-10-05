import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { LeadTimelineSource } from '@prisma/client';

import { PrismaService } from '../../../core/database/prisma.service';

import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateLeadActivityDto } from './dto/create-lead-activity.dto';
import {
  LEAD_ACTOR_SELECT,
  LEAD_HISTORY_INCLUDE,
} from './lead-history.include';

// Tolerance for client/server clock skew when rejecting future-dated activity.
const OCCURRED_AT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

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
          ...LEAD_HISTORY_INCLUDE,
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

  // Employee sales activity (call, meeting, email, ...). Recorded on the lead
  // timeline as source EMPLOYEE. It never changes lead status, and it is not
  // a follow-up: scheduling stays in LeadFollowup. The action code is
  // server-assigned (ACTIVITY_<TYPE>) so an employee can never write a system
  // lifecycle event, and the actor always comes from the authenticated user.
  async createActivity(
    leadId: string,
    actorId: string | undefined,
    data: CreateLeadActivityDto,
  ) {
    if (!actorId) {
      throw new UnauthorizedException('Authenticated user required.');
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found.');
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true },
    });

    if (!actor) {
      throw new UnauthorizedException('Authenticated user not found.');
    }

    const now = new Date();
    const occurredAt = data.occurredAt ? new Date(data.occurredAt) : now;

    if (
      occurredAt.getTime() >
      now.getTime() + OCCURRED_AT_FUTURE_TOLERANCE_MS
    ) {
      throw new BadRequestException('occurredAt cannot be in the future.');
    }

    // The lead's updatedAt backs "last activity" in the UI, so touch it in
    // the same transaction as the new entry.
    const [entry] = await this.prisma.$transaction([
      this.prisma.leadTimeline.create({
        data: {
          leadId,
          source: LeadTimelineSource.EMPLOYEE,
          activityType: data.activityType,
          action: `ACTIVITY_${data.activityType}`,
          remarks: data.remarks,
          actorId,
          occurredAt,
        },
        include: {
          actor: { select: LEAD_ACTOR_SELECT },
        },
      }),
      this.prisma.lead.update({
        where: { id: leadId },
        data: { updatedAt: now },
        select: { id: true },
      }),
    ]);

    return entry;
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

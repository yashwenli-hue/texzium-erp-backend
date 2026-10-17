import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { LeadFollowupStatus, LeadTimelineSource, Prisma } from '@prisma/client';

import { PrismaService } from '../../../core/database/prisma.service';

import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateLeadActivityDto } from './dto/create-lead-activity.dto';
import { SearchLeadsQueryDto } from './dto/search-leads-query.dto';
import { searchLeads } from './lead-search';
import { findLeadDuplicates, ReturningOptions } from './lead-duplicates';
import { GSTIN_PATTERN } from '../customer-gst/customer-gst-values';
import { LeadDuplicateCheckQueryDto } from './dto/lead-duplicate-check.dto';
import {
  LEAD_ACTOR_SELECT,
  LEAD_HISTORY_INCLUDE,
} from './lead-history.include';
import {
  LEAD_DEACTIVATED_MESSAGE,
  LEAD_LIFECYCLE_INCLUDE,
  LEAD_PRODUCT_SELECT,
  lockActiveLeadForUpdate,
  lockLeadForDeactivation,
} from './lead-lifecycle';
import {
  LeadLocation,
  assertLeadLocation,
  mergeLeadLocation,
} from './lead-location';
import { ALL_RECORDS, RecordScope, and, leadWhere } from '../record-scope/record-scope';

// Tolerance for client/server clock skew when rejecting future-dated activity.
const OCCURRED_AT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // The creator is recorded on LEAD_CREATED (it is also how the person who entered the
  // lead keeps sight of it). Leads that arrive from the WhatsApp bot or a webhook are
  // created elsewhere and have no actor.
  async create(data: CreateLeadDto, actorId?: string) {
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

    // Nothing is inferred when no location is given: all three stay null.
    const location: LeadLocation = {
      country: data.country ?? null,
      state: data.state ?? null,
      city: data.city ?? null,
    };

    assertLeadLocation(location);

    if (data.inventoryItemId) await this.assertProduct(data.inventoryItemId);

    const lead = await this.prisma.lead.create({
      data: {
        leadCode: data.leadCode,
        customerName: data.customerName,
        companyName: data.companyName,
        email: data.email,
        phone: data.phone,
        alternatePhone: data.alternatePhone,
        sourceId: data.sourceId,
        inventoryItemId: data.inventoryItemId ?? null,
        country: location.country,
        state: location.state,
        city: location.city,
      },
      include: {
        source: true,
        assignedTo: { select: LEAD_ACTOR_SELECT },
        inventoryItem: { select: LEAD_PRODUCT_SELECT },
      },
    });

    await this.prisma.leadTimeline.create({
      data: {
        leadId: lead.id,
        action: 'LEAD_CREATED',
        remarks: 'Lead created manually.',
        actorId: actorId ?? null,
      },
    });

    return lead;
  }

  // A product given for a lead must be an existing inventory item (nothing is created).
  private async assertProduct(id: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Product not found.');
  }

  async findAll(includeInactive = false, scope: RecordScope = ALL_RECORDS) {
    return this.prisma.lead.findMany({
      where: and<Prisma.LeadWhereInput>(includeInactive ? undefined : { isActive: true }, leadWhere(scope)),
      include: {
        source: true,
        assignedTo: { select: LEAD_ACTOR_SELECT },
        inventoryItem: { select: LEAD_PRODUCT_SELECT },
        followups: true,
        opportunities: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // The Leads list and the Pre-Sales panel: filtered, sorted, paged and counted on the
  // server, inside the caller's record scope (lead-search.ts).
  async search(query: SearchLeadsQueryDto, scope: RecordScope) {
    return searchLeads(this.prisma, query, scope);
  }

  // Likely duplicates of a lead being entered (lead-duplicates.ts).
  async duplicateCheck(
    query: LeadDuplicateCheckQueryDto,
    scope: RecordScope,
    options: ReturningOptions = { canViewCustomers: true },
  ) {
    const gstin =
      query.gstin && GSTIN_PATTERN.test(query.gstin) ? query.gstin : null;
    return findLeadDuplicates(this.prisma, { ...query, gstin }, scope, options);
  }

  // Likely duplicates of an existing lead, each marked earlier or later than it.
  async duplicatesOf(
    id: string,
    scope: RecordScope,
    options: ReturningOptions = { canViewCustomers: true },
  ) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      select: { phone: true, alternatePhone: true, email: true, customerName: true, companyName: true, city: true, createdAt: true, inventoryItemId: true },
    });
    if (!lead) throw new NotFoundException('Lead not found.');
    return findLeadDuplicates(this.prisma, { ...lead, excludeLeadId: id }, scope, options);
  }

  async findOne(id: string) {
    const lead =
      await this.prisma.lead.findUnique({
        where: {
          id,
        },
        include: {
          source: true,
          assignedTo: { select: LEAD_ACTOR_SELECT },
          inventoryItem: { select: LEAD_PRODUCT_SELECT },
          deactivatedBy: { select: LEAD_ACTOR_SELECT },
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

    if (data.outcome && data.activityType !== 'CALL') {
      throw new BadRequestException('Only a call has an outcome.');
    }

    if (!data.remarks && !data.outcome) {
      throw new BadRequestException(
        'Write what happened, or choose the call outcome.',
      );
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, isActive: true },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found.');
    }

    if (!lead.isActive) {
      throw new ConflictException(LEAD_DEACTIVATED_MESSAGE);
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
    // the same transaction as the new entry. The lock makes this wait for a
    // deactivation or deletion of the lead in progress and then see its result.
    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, leadId);

      const entry = await tx.leadTimeline.create({
        data: {
          leadId,
          source: LeadTimelineSource.EMPLOYEE,
          activityType: data.activityType,
          action: `ACTIVITY_${data.activityType}`,
          remarks: data.remarks ?? null,
          outcome: data.outcome ?? null,
          actorId,
          occurredAt,
        },
        include: {
          actor: { select: LEAD_ACTOR_SELECT },
        },
      });

      await tx.lead.update({
        where: { id: leadId },
        data: { updatedAt: now },
        select: { id: true },
      });

      return entry;
    });
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

    if (!existing.isActive) {
      throw new ConflictException(LEAD_DEACTIVATED_MESSAGE);
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

    if (data.inventoryItemId) await this.assertProduct(data.inventoryItemId);

    // The location is judged as a whole: what is stored with the change applied.
    // A field that is absent keeps its value, null clears it. A lead that has no
    // location and is edited without one stays valid.
    assertLeadLocation(
      mergeLeadLocation(
        {
          country: existing.country ?? null,
          state: existing.state ?? null,
          city: existing.city ?? null,
        },
        {
          country: data.country,
          state: data.state,
          city: data.city,
        },
      ),
    );

    // The edit and its history event are one change, made under the lock so that a
    // deactivation or deletion of the lead in progress is waited for.
    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, id);

      const lead = await tx.lead.update({
        where: {
          id,
        },
        data,
        include: {
          source: true,
          assignedTo: { select: LEAD_ACTOR_SELECT },
          inventoryItem: { select: LEAD_PRODUCT_SELECT },
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: id,
          action: 'LEAD_UPDATED',
          remarks: 'Lead information updated.',
        },
      });

      return lead;
    });
  }

  // Takes a lead out of active work without deleting anything. The conditional
  // update only matches an active lead with no opportunities and no pending
  // follow-ups, so the rules hold even if something is created at the same
  // moment. Follow-ups and opportunities are never touched.
  async deactivate(
    id: string,
    actorId: string | undefined,
    reason: string,
  ) {
    await this.requireActor(actorId);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Wait for any opportunity or follow-up being created for this lead to
      // finish, so the checks below see it.
      await lockLeadForDeactivation(tx, id);

      const result = await tx.lead.updateMany({
        where: {
          id,
          isActive: true,
          opportunities: { none: {} },
          followups: { none: { status: LeadFollowupStatus.PENDING } },
        },
        data: {
          isActive: false,
          deactivatedAt: now,
          deactivatedById: actorId,
          deactivationReason: reason,
        },
      });

      if (result.count === 0) {
        await this.explainDeactivationConflict(tx, id);
      }

      // A lifecycle event performed by a person: still SYSTEM history, with the
      // actor recorded. It is not an employee activity.
      await tx.leadTimeline.create({
        data: {
          leadId: id,
          action: 'LEAD_DEACTIVATED',
          remarks: reason,
          actorId,
          occurredAt: now,
        },
      });

      return tx.lead.findUnique({
        where: { id },
        include: LEAD_LIFECYCLE_INCLUDE,
      });
    });
  }

  // Simply restores the lead to active. Opportunities and follow-ups are left
  // exactly as they are; the permanent history stays in the timeline.
  async reactivate(id: string, actorId: string | undefined) {
    await this.requireActor(actorId);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Same exclusive lock as deactivation (and deletion): a reactivation cannot
      // overlap either.
      await lockLeadForDeactivation(tx, id);

      const result = await tx.lead.updateMany({
        where: { id, isActive: false },
        data: {
          isActive: true,
          deactivatedAt: null,
          deactivatedById: null,
          deactivationReason: null,
        },
      });

      if (result.count === 0) {
        const lead = await tx.lead.findUnique({
          where: { id },
          select: { id: true },
        });

        if (!lead) {
          throw new NotFoundException('Lead not found.');
        }

        throw new ConflictException('This lead is already active.');
      }

      await tx.leadTimeline.create({
        data: {
          leadId: id,
          action: 'LEAD_REACTIVATED',
          remarks: 'Lead reactivated.',
          actorId,
          occurredAt: now,
        },
      });

      return tx.lead.findUnique({
        where: { id },
        include: LEAD_LIFECYCLE_INCLUDE,
      });
    });
  }

  private async requireActor(actorId: string | undefined) {
    if (!actorId) {
      throw new UnauthorizedException('Authenticated user required.');
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true },
    });

    if (!actor) {
      throw new UnauthorizedException('Authenticated user not found.');
    }
  }

  // Runs only after the conditional update matched nothing: works out why, so
  // the message names the real blockers. Always throws.
  private async explainDeactivationConflict(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<never> {
    const lead = await tx.lead.findUnique({
      where: { id },
      select: {
        isActive: true,
        _count: {
          select: {
            opportunities: true,
            followups: {
              where: { status: LeadFollowupStatus.PENDING },
            },
          },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found.');
    }

    if (!lead.isActive) {
      throw new ConflictException('This lead is already deactivated.');
    }

    const blockers: string[] = [];
    const opportunities = lead._count.opportunities;
    const pendingFollowups = lead._count.followups;

    if (opportunities > 0) {
      blockers.push(
        `${opportunities} ${opportunities === 1 ? 'opportunity' : 'opportunities'}`,
      );
    }

    if (pendingFollowups > 0) {
      blockers.push(
        `${pendingFollowups} pending ${pendingFollowups === 1 ? 'follow-up' : 'follow-ups'}`,
      );
    }

    if (blockers.length === 0) {
      throw new ConflictException(
        'This lead could not be deactivated. Please try again.',
      );
    }

    throw new ConflictException(
      `This lead can't be deactivated while it has ${blockers.join(' and ')}.`,
    );
  }
}

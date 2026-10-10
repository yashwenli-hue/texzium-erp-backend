import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { LeadTimelineSource } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { UnassignLeadDto } from './dto/unassign-lead.dto';
import { lockActiveLeadForUpdate } from '../leads/lead-lifecycle';

// Each change and its history event are one transaction under the lock on the
// lead, so a deactivation or deletion of the lead in progress is waited for and then
// seen (404 / 409), never raced.
@Injectable()
export class LeadAssignmentsService {
  constructor(private prisma: PrismaService) {}

  async assign(data: AssignLeadDto) {
    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, data.leadId);

      const lead = await tx.lead.update({
        where: { id: data.leadId },
        data: {
          assignedToId: data.assignedToId,
          status: 'PRE_SALES_ASSIGNED',
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: lead.id,
          action: 'PRE_SALES_ASSIGNED',
          remarks: `Assigned to pre-sales user ${data.assignedToId}`,
        },
      });

      return lead;
    });
  }

  async qualifyLead(
    leadId: string,
    salesUserId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, leadId);

      const lead = await tx.lead.update({
        where: { id: leadId },
        data: {
          assignedToId: salesUserId,
          status: 'SALES_ASSIGNED',
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: lead.id,
          action: 'LEAD_QUALIFIED',
          remarks: `Lead qualified and assigned to sales ${salesUserId}`,
        },
      });

      return lead;
    });
  }

  async rejectLead(
    leadId: string,
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, leadId);

      const lead = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: 'REJECTED',
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: lead.id,
          action: 'LEAD_REJECTED',
          remarks: reason,
        },
      });

      return lead;
    });
  }

  // Undoes an assignment that nothing has built on yet: only an active lead in
  // PRE_SALES_ASSIGNED, still assigned to the person the caller saw, goes back to NEW
  // with no assignee. One LEAD_UNASSIGNED event records who did it (source SYSTEM like
  // every assignment event, so the lead stays deletable) and the optional remark.
  // Earlier history is never touched. The lock makes concurrent unassignments
  // (or a reassignment in progress) wait, so only one of them can succeed.
  async unassign(
    leadId: string,
    data: UnassignLeadDto,
    actorId: string | undefined,
  ) {
    if (!actorId) {
      throw new UnauthorizedException('Authenticated user required.');
    }

    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, leadId);

      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { id: true },
      });

      if (!actor) {
        throw new UnauthorizedException('Authenticated user not found.');
      }

      const lead = await tx.lead.findUnique({
        where: { id: leadId },
        select: {
          status: true,
          assignedToId: true,
          assignedTo: { select: { fullName: true } },
        },
      });

      if (!lead) {
        throw new NotFoundException('Lead not found.');
      }

      if (lead.status !== 'PRE_SALES_ASSIGNED' || !lead.assignedToId) {
        throw new ConflictException(
          'Only a lead that is assigned to pre-sales (Pre Sales Assigned) can be unassigned.',
        );
      }

      if (lead.assignedToId !== data.assignedToId) {
        throw new ConflictException(
          "This lead's assignment has changed. Reload the lead and try again.",
        );
      }

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: {
          assignedToId: null,
          status: 'NEW',
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId,
          action: 'LEAD_UNASSIGNED',
          remarks: `Unassigned from ${lead.assignedTo?.fullName ?? lead.assignedToId}; status returned to New.`,
          userRemark: data.remarks ?? null,
          source: LeadTimelineSource.SYSTEM,
          actorId: actor.id,
        },
      });

      return updated;
    });
  }
}

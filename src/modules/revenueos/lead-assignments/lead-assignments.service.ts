import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { LeadTimelineSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { QualifyLeadDto } from './dto/qualify-lead.dto';
import { RejectLeadDto } from './dto/reject-lead.dto';
import { UnassignLeadDto } from './dto/unassign-lead.dto';
import { ReopenLeadDto } from './dto/reopen-lead.dto';
import { lockActiveLeadForUpdate } from '../leads/lead-lifecycle';
import {
  assignRefusal,
  canAssignLeadFrom,
  canQualifyLeadFrom,
  canRejectLeadFrom,
  canReopenLeadFrom,
  LEAD_REOPEN_TARGET,
  leadStatusLabel,
  qualifyRefusal,
  rejectRefusal,
  reopenRefusal,
} from './lead-transitions';

type Tx = Prisma.TransactionClient;

// The actor is the authenticated user, never anything the client sends. Checked
// inside the transaction so the history event never points at a missing user.
async function requireActor(tx: Tx, actorId: string) {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { id: true },
  });

  if (!actor) {
    throw new UnauthorizedException('Authenticated user not found.');
  }

  return actor;
}

// The lead as it is now, read under the lock.
async function currentLead(tx: Tx, leadId: string) {
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

  return lead;
}

// Only an existing, ACTIVE user can take a lead (INACTIVE and SUSPENDED cannot).
async function requireActiveAssignee(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, status: true },
  });

  if (!user) {
    throw new BadRequestException('The selected user does not exist.');
  }

  if (user.status !== 'ACTIVE') {
    throw new ConflictException(
      'The selected user is not active and cannot take leads.',
    );
  }

  return user;
}

// " (previously Asha Rao)" when someone else held the lead; nothing otherwise.
function previously(
  lead: {
    assignedToId: string | null;
    assignedTo: { fullName: string } | null;
  },
  newAssigneeId: string,
) {
  if (!lead.assignedToId || lead.assignedToId === newAssigneeId) return '';

  return ` (previously ${lead.assignedTo?.fullName ?? lead.assignedToId})`;
}

// Each change and its history event are one transaction under the lock on the
// lead, so a deactivation or deletion of the lead in progress is waited for and then
// seen (404 / 409), never raced, and two changes to the same lead run one after the
// other: the second sees the first (a second qualification or rejection is a 409).
// Every event records who did it (source SYSTEM, so the lead's deletability is
// unchanged) and names the people involved as they were called at the time. The
// allowed starting statuses are in lead-transitions.ts.
@Injectable()
export class LeadAssignmentsService {
  constructor(private prisma: PrismaService) {}

  async assign(data: AssignLeadDto, actorId: string | undefined) {
    if (!actorId) {
      throw new UnauthorizedException('Authenticated user required.');
    }

    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, data.leadId);
      const actor = await requireActor(tx, actorId);
      const lead = await currentLead(tx, data.leadId);

      if (!canAssignLeadFrom(lead.status)) {
        throw new ConflictException(assignRefusal(lead.status));
      }

      const assignee = await requireActiveAssignee(tx, data.assignedToId);

      if (
        lead.status === 'PRE_SALES_ASSIGNED' &&
        lead.assignedToId === assignee.id
      ) {
        throw new ConflictException(
          `This lead is already assigned to ${assignee.fullName}.`,
        );
      }

      const updated = await tx.lead.update({
        where: { id: data.leadId },
        data: {
          assignedToId: assignee.id,
          status: 'PRE_SALES_ASSIGNED',
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: data.leadId,
          action: 'PRE_SALES_ASSIGNED',
          remarks: `Assigned to pre-sales: ${assignee.fullName}${previously(lead, assignee.id)}.`,
          source: LeadTimelineSource.SYSTEM,
          actorId: actor.id,
          subjectUserId: assignee.id,
        },
      });

      return updated;
    });
  }

  async qualifyLead(
    leadId: string,
    data: QualifyLeadDto,
    actorId: string | undefined,
  ) {
    if (!actorId) {
      throw new UnauthorizedException('Authenticated user required.');
    }

    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, leadId);
      const actor = await requireActor(tx, actorId);
      const lead = await currentLead(tx, leadId);

      if (!canQualifyLeadFrom(lead.status)) {
        throw new ConflictException(qualifyRefusal(lead.status));
      }

      const salesUser = await requireActiveAssignee(tx, data.salesUserId);

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: {
          assignedToId: salesUser.id,
          status: 'SALES_ASSIGNED',
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId,
          action: 'LEAD_QUALIFIED',
          remarks: `Qualified and assigned to sales: ${salesUser.fullName}${previously(lead, salesUser.id)}.`,
          source: LeadTimelineSource.SYSTEM,
          actorId: actor.id,
          subjectUserId: salesUser.id,
        },
      });

      return updated;
    });
  }

  // The assignee is kept: the rejection is a decision about the lead, recorded with
  // who made it and, as their remark, why.
  async rejectLead(
    leadId: string,
    data: RejectLeadDto,
    actorId: string | undefined,
  ) {
    if (!actorId) {
      throw new UnauthorizedException('Authenticated user required.');
    }

    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, leadId);
      const actor = await requireActor(tx, actorId);
      const lead = await currentLead(tx, leadId);

      if (!canRejectLeadFrom(lead.status)) {
        throw new ConflictException(rejectRefusal(lead.status));
      }

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: 'REJECTED',
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId,
          action: 'LEAD_REJECTED',
          remarks: 'Lead rejected.',
          userRemark: data.reason,
          source: LeadTimelineSource.SYSTEM,
          actorId: actor.id,
        },
      });

      return updated;
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
          subjectUserId: lead.assignedToId,
        },
      });

      return updated;
    });
  }

  // Takes a rejected lead back into pre-qualification work (Contacted). The reason is
  // required and kept as the person's remark on LEAD_REOPENED; the rejection and every
  // earlier event stay as they are. The assignee is kept, as reject kept it. Under the
  // lock, so a second reopen (or a reopen racing a deactivation) sees the first: 409.
  async reopen(
    leadId: string,
    data: ReopenLeadDto,
    actorId: string | undefined,
  ) {
    if (!actorId) {
      throw new UnauthorizedException('Authenticated user required.');
    }

    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, leadId);
      const actor = await requireActor(tx, actorId);
      const lead = await currentLead(tx, leadId);

      if (!canReopenLeadFrom(lead.status)) {
        throw new ConflictException(reopenRefusal(lead.status));
      }

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: { status: LEAD_REOPEN_TARGET },
      });

      await tx.leadTimeline.create({
        data: {
          leadId,
          action: 'LEAD_REOPENED',
          remarks: `Lead reopened; status returned to ${leadStatusLabel(LEAD_REOPEN_TARGET)}.`,
          userRemark: data.reason,
          source: LeadTimelineSource.SYSTEM,
          actorId: actor.id,
        },
      });

      return updated;
    });
  }
}

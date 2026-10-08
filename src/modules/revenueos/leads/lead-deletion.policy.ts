import { LeadFollowupStatus, LeadTimelineSource, Prisma } from '@prisma/client';

import {
  DELETION_ENTITY,
  Db,
  DeletionBlocker,
  DeletionEvaluation,
  DeletionLine,
  DeletionPolicy,
  versionOf,
} from '../data-governance/data-deletion';

// Governed deletion of a lead: for a lead that was entered by mistake, is a duplicate,
// a test or junk, and has had no real work done on it.
//
// What stands in the way (anything else the lead owns is removed with it, after being
// copied into the tombstone):
//
//   - any opportunity (the quotations, orders, invoices and payments that follow an
//     opportunity are never deleted, so a lead with one is part of the pipeline);
//   - any activity logged by an employee (a person's work is part of the record);
//   - a qualification or a rejection (a sales decision);
//   - any completed follow-up (work that was done);
//   - any pending follow-up (cancel it first, as for deactivation).
//
// Everything the system itself wrote does NOT block: creation, import, edits, status
// and assignment events, deactivation and reactivation, follow-up bookkeeping, and the
// imported requirement notes. Those are removed with the lead and are in the tombstone.
export const LEAD_BLOCKER = {
  OPPORTUNITIES: 'LEAD_HAS_OPPORTUNITIES',
  EMPLOYEE_ACTIVITY: 'LEAD_HAS_EMPLOYEE_ACTIVITY',
  QUALIFIED_OR_REJECTED: 'LEAD_QUALIFIED_OR_REJECTED',
  COMPLETED_FOLLOWUPS: 'LEAD_HAS_COMPLETED_FOLLOWUPS',
  PENDING_FOLLOWUPS: 'LEAD_HAS_PENDING_FOLLOWUPS',
} as const;

export const LEAD_DECISION_ACTIONS = ['LEAD_QUALIFIED', 'LEAD_REJECTED'];

export const LEAD_DUPLICATE_REMOVED_ACTION = 'LEAD_DUPLICATE_REMOVED';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function leadBlockers(counts: {
  opportunities: number;
  employeeActivity: number;
  decisions: number;
  completedFollowups: number;
  pendingFollowups: number;
}): DeletionBlocker[] {
  const blockers: DeletionBlocker[] = [];

  if (counts.opportunities > 0) {
    blockers.push({
      code: LEAD_BLOCKER.OPPORTUNITIES,
      count: counts.opportunities,
      message: `It has ${counts.opportunities} ${plural(counts.opportunities, 'opportunity', 'opportunities')}, so it is part of the sales pipeline.`,
      hint: 'Opportunities, and the quotations and orders that follow them, are never deleted with a lead.',
    });
  }

  if (counts.employeeActivity > 0) {
    blockers.push({
      code: LEAD_BLOCKER.EMPLOYEE_ACTIVITY,
      count: counts.employeeActivity,
      message: `${counts.employeeActivity} ${plural(counts.employeeActivity, 'activity was', 'activities were')} logged on it by your team.`,
      hint: 'Work your team logged is part of the record and is kept.',
    });
  }

  if (counts.decisions > 0) {
    blockers.push({
      code: LEAD_BLOCKER.QUALIFIED_OR_REJECTED,
      count: counts.decisions,
      message: 'A sales decision (qualified or rejected) was recorded on it.',
      hint: 'A decision on a lead is part of the record and is kept.',
    });
  }

  if (counts.completedFollowups > 0) {
    blockers.push({
      code: LEAD_BLOCKER.COMPLETED_FOLLOWUPS,
      count: counts.completedFollowups,
      message: `${counts.completedFollowups} ${plural(counts.completedFollowups, 'follow-up was', 'follow-ups were')} completed.`,
      hint: 'A completed follow-up is work that was done and is kept.',
    });
  }

  if (counts.pendingFollowups > 0) {
    blockers.push({
      code: LEAD_BLOCKER.PENDING_FOLLOWUPS,
      count: counts.pendingFollowups,
      message: `It has ${counts.pendingFollowups} pending ${plural(counts.pendingFollowups, 'follow-up', 'follow-ups')}.`,
      hint: 'Cancel its pending follow-ups first.',
    });
  }

  return blockers;
}

async function evaluate(
  db: Db,
  id: string,
): Promise<DeletionEvaluation | null> {
  const lead = await db.lead.findUnique({
    where: { id },
    select: {
      id: true,
      customerName: true,
      leadCode: true,
      isActive: true,
      updatedAt: true,
    },
  });

  if (!lead) {
    return null;
  }

  const [
    opportunities,
    employeeActivity,
    decisions,
    pendingFollowups,
    completedFollowups,
    cancelledFollowups,
    timelineEvents,
    notes,
  ] = await Promise.all([
    db.opportunity.count({ where: { leadId: id } }),
    db.leadTimeline.count({
      where: { leadId: id, source: LeadTimelineSource.EMPLOYEE },
    }),
    db.leadTimeline.count({
      where: { leadId: id, action: { in: LEAD_DECISION_ACTIONS } },
    }),
    db.leadFollowup.count({
      where: { leadId: id, status: LeadFollowupStatus.PENDING },
    }),
    db.leadFollowup.count({
      where: { leadId: id, status: LeadFollowupStatus.COMPLETED },
    }),
    db.leadFollowup.count({
      where: { leadId: id, status: LeadFollowupStatus.CANCELLED },
    }),
    db.leadTimeline.count({ where: { leadId: id } }),
    db.leadNote.count({ where: { leadId: id } }),
  ]);

  const removes: DeletionLine[] = [
    { label: 'The lead record', count: 1 },
    { label: 'History events', count: timelineEvents },
    { label: 'Imported notes', count: notes },
    { label: 'Cancelled follow-ups', count: cancelledFollowups },
  ].filter((line) => line.count > 0);

  return {
    label: lead.customerName,
    code: lead.leadCode,
    blockers: leadBlockers({
      opportunities,
      employeeActivity,
      decisions,
      completedFollowups,
      pendingFollowups,
    }),
    removes,
    version: versionOf({
      updatedAt: lead.updatedAt.toISOString(),
      isActive: lead.isActive,
      opportunities,
      employeeActivity,
      decisions,
      pendingFollowups,
      completedFollowups,
      cancelledFollowups,
      timelineEvents,
      notes,
    }),
  };
}

export const LEAD_DELETION_POLICY: DeletionPolicy = {
  entityType: DELETION_ENTITY.LEAD,
  noun: 'lead',
  notFoundMessage: 'Lead not found.',
  blockerCodes: Object.values(LEAD_BLOCKER),

  async lockRows(tx, ids) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Lead"
      WHERE "id" IN (${Prisma.join(ids)})
      ORDER BY "id"
      FOR UPDATE
    `;

    return rows.map((row) => row.id);
  },

  evaluate,

  async survivorLabel(db, id) {
    const lead = await db.lead.findUnique({
      where: { id },
      select: { customerName: true },
    });

    return lead?.customerName ?? null;
  },

  // The lead and everything removed with it, in full, and the people they name (so the
  // copy still reads without the User table).
  async capture(db, id) {
    const lead = await db.lead.findUniqueOrThrow({
      where: { id },
      include: { source: true },
    });

    const [timelines, notes, followups] = await Promise.all([
      db.leadTimeline.findMany({
        where: { leadId: id },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
      db.leadNote.findMany({
        where: { leadId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      db.leadFollowup.findMany({
        where: { leadId: id },
        orderBy: [{ followupDate: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const personIds = new Set<string>();

    for (const id of [
      lead.assignedToId,
      lead.deactivatedById,
      ...timelines.map((entry) => entry.actorId),
      ...followups.map((followup) => followup.completedById),
    ]) {
      if (id) {
        personIds.add(id);
      }
    }

    const people = await db.user.findMany({
      where: { id: { in: [...personIds] } },
      select: { id: true, fullName: true, email: true },
    });

    // Through JSON, so dates become ISO strings and the snapshot is exactly what the
    // database will hold.
    return JSON.parse(
      JSON.stringify({
        schemaVersion: 1,
        lead,
        timelines,
        notes,
        followups,
        people,
      }),
    ) as Prisma.InputJsonValue;
  },

  async remove(tx, id) {
    await tx.leadTimeline.deleteMany({ where: { leadId: id } });
    await tx.leadNote.deleteMany({ where: { leadId: id } });
    await tx.leadFollowup.deleteMany({ where: { leadId: id } });
    await tx.lead.delete({ where: { id } });
  },

  async recordSurvivorEvent(tx, event) {
    await tx.leadTimeline.create({
      data: {
        leadId: event.survivorId,
        action: LEAD_DUPLICATE_REMOVED_ACTION,
        remarks: `Duplicate lead "${event.removedLabel}" was permanently deleted. Reason: ${event.reason}`,
        actorId: event.actorId,
      },
    });
  },
};

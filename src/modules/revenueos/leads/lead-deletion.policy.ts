import { LeadFollowupStatus, LeadTimelineSource, Prisma } from '@prisma/client';

import {
  DELETION_ENTITY,
  Db,
  DeletionBlocker,
  DeletionEvaluation,
  DeletionLine,
  DeletionPolicy,
  RestoreConflict,
  RestoreEvaluation,
  versionOf,
} from '../data-governance/data-deletion';
import {
  idsOf,
  isRow,
  reviveRow,
  rowsOf,
  uniqueStrings,
} from '../data-governance/snapshot';

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
  CONTENT_SHARED: 'LEAD_HAS_CONTENT_SHARES',
} as const;

export const LEAD_DECISION_ACTIONS = ['LEAD_QUALIFIED', 'LEAD_REJECTED'];

export const LEAD_DUPLICATE_REMOVED_ACTION = 'LEAD_DUPLICATE_REMOVED';
export const LEAD_DUPLICATE_RESTORED_ACTION = 'LEAD_DUPLICATE_RESTORED';
// What a survivor's history says about a duplicate once that duplicate has been erased for good.
export const LEAD_DUPLICATE_ERASED_REMARK =
  'A duplicate lead was moved to the Recycle Bin and has since been permanently erased.';
export const LEAD_RESTORED_ACTION = 'LEAD_RESTORED';

export const LEAD_RESTORE_CONFLICT = {
  SNAPSHOT_INVALID: 'LEAD_SNAPSHOT_INVALID',
  ID_EXISTS: 'LEAD_ID_EXISTS',
  CODE_TAKEN: 'LEAD_CODE_TAKEN',
  SOURCE_MISSING: 'LEAD_SOURCE_MISSING',
  USER_MISSING: 'LEAD_USER_MISSING',
  CHILD_ID_EXISTS: 'LEAD_CHILD_ID_EXISTS',
} as const;

// The columns a restore writes, per table (and which are dates). The lead's updatedAt is
// not taken from the snapshot: a restored lead is "updated" when it is restored.
const LEAD_COLUMNS = [
  'id',
  'leadCode',
  'customerName',
  'companyName',
  'email',
  'phone',
  'alternatePhone',
  'sourceId',
  'assignedToId',
  'country',
  'state',
  'city',
  'status',
  'isActive',
  'deactivatedAt',
  'deactivatedById',
  'deactivationReason',
  'createdAt',
] as const;
const LEAD_DATES = ['deactivatedAt', 'createdAt'] as const;
const TIMELINE_COLUMNS = [
  'id',
  'leadId',
  'action',
  'remarks',
  'userRemark',
  'source',
  'activityType',
  'actorId',
  'outcome',
  'subjectUserId',
  'occurredAt',
  'createdAt',
] as const;
const TIMELINE_DATES = ['occurredAt', 'createdAt'] as const;
const NOTE_COLUMNS = ['id', 'leadId', 'note', 'createdAt'] as const;
const NOTE_DATES = ['createdAt'] as const;
const FOLLOWUP_COLUMNS = [
  'id',
  'leadId',
  'followupDate',
  'remarks',
  'status',
  'completedAt',
  'completedById',
  'createdAt',
  'updatedAt',
] as const;
const FOLLOWUP_DATES = [
  'followupDate',
  'completedAt',
  'createdAt',
  'updatedAt',
] as const;

// The snapshot as restore reads it, or null when it is not a lead snapshot.
function readLeadSnapshot(snapshot: unknown) {
  if (!isRow(snapshot) || !isRow(snapshot.lead)) {
    return null;
  }

  const lead = snapshot.lead;

  if (typeof lead.id !== 'string' || typeof lead.sourceId !== 'string') {
    return null;
  }

  return {
    lead,
    timelines: rowsOf(snapshot.timelines),
    notes: rowsOf(snapshot.notes),
    followups: rowsOf(snapshot.followups),
  };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function leadBlockers(counts: {
  opportunities: number;
  employeeActivity: number;
  decisions: number;
  completedFollowups: number;
  pendingFollowups: number;
  contentShares?: number;
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

  const shares = counts.contentShares ?? 0;
  if (shares > 0) {
    blockers.push({
      code: LEAD_BLOCKER.CONTENT_SHARED,
      count: shares,
      message: `Sales content was shared with it ${shares} ${plural(shares, 'time', 'times')}.`,
      hint: 'Content shared with a lead is customer contact and is kept.',
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
    contentShares,
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
    db.contentShare.count({ where: { leadId: id } }),
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
      contentShares,
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
      contentShares,
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
      ...timelines.map((entry) => entry.subjectUserId),
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

  async restoreEvaluate(db, snapshot, record): Promise<RestoreEvaluation> {
    const snap = readLeadSnapshot(snapshot);

    if (!snap) {
      return {
        conflicts: [
          {
            code: LEAD_RESTORE_CONFLICT.SNAPSHOT_INVALID,
            message: 'The saved copy of this lead is not readable.',
          },
        ],
        restores: [],
        facts: {},
      };
    }

    const { lead, timelines, notes, followups } = snap;
    const conflicts: RestoreConflict[] = [];

    const exists = await db.lead.findUnique({
      where: { id: record.entityId },
      select: { id: true },
    });

    if (exists) {
      conflicts.push({
        code: LEAD_RESTORE_CONFLICT.ID_EXISTS,
        message: 'A lead with this identity already exists.',
      });
    }

    if (typeof lead.leadCode === 'string' && lead.leadCode !== '') {
      const taken = await db.lead.findUnique({
        where: { leadCode: lead.leadCode },
        select: { customerName: true },
      });

      if (taken) {
        conflicts.push({
          code: LEAD_RESTORE_CONFLICT.CODE_TAKEN,
          message: `Its lead code ${lead.leadCode} is now used by "${taken.customerName}".`,
        });
      }
    }

    const source = await db.leadSource.findUnique({
      where: { id: lead.sourceId as string },
      select: { id: true },
    });

    if (!source) {
      conflicts.push({
        code: LEAD_RESTORE_CONFLICT.SOURCE_MISSING,
        message: 'Its lead source no longer exists.',
      });
    }

    const personIds = uniqueStrings([
      lead.assignedToId,
      lead.deactivatedById,
      ...timelines.map((row) => row.actorId),
      ...timelines.map((row) => row.subjectUserId),
      ...followups.map((row) => row.completedById),
    ]);
    const people = await db.user.findMany({
      where: { id: { in: personIds } },
      select: { id: true },
    });

    if (people.length !== personIds.length) {
      conflicts.push({
        code: LEAD_RESTORE_CONFLICT.USER_MISSING,
        message:
          'A person named in its history (the assignee, or who acted on it) no longer exists.',
      });
    }

    const [clashTimeline, clashNotes, clashFollowups] = await Promise.all([
      db.leadTimeline.count({ where: { id: { in: idsOf(timelines) } } }),
      db.leadNote.count({ where: { id: { in: idsOf(notes) } } }),
      db.leadFollowup.count({ where: { id: { in: idsOf(followups) } } }),
    ]);

    if (clashTimeline + clashNotes + clashFollowups > 0) {
      conflicts.push({
        code: LEAD_RESTORE_CONFLICT.CHILD_ID_EXISTS,
        message: 'Part of its history already exists under the same identity.',
      });
    }

    const restores: DeletionLine[] = [
      { label: 'The lead record', count: 1 },
      { label: 'History events', count: timelines.length },
      { label: 'Imported notes', count: notes.length },
      { label: 'Cancelled follow-ups', count: followups.length },
    ].filter((line) => line.count > 0);

    return {
      conflicts,
      restores,
      facts: {
        timelines: timelines.length,
        notes: notes.length,
        followups: followups.length,
      },
    };
  },

  // Nothing to lock for a lead that does not exist: the tombstone is locked by the
  // caller (two restores of one record are serialised), the lead code has a unique
  // index and the references have foreign keys, which are the backstop for a conflict
  // that appears after the checks.
  async lockForRestore() {
    return Promise.resolve();
  },

  async restore(tx, snapshot, context) {
    const snap = readLeadSnapshot(snapshot);

    if (!snap) {
      throw new Error('The saved copy of this lead is not readable.');
    }

    const leadRow = reviveRow(snap.lead, LEAD_COLUMNS, LEAD_DATES);

    await tx.lead.create({
      data: {
        ...(leadRow as Prisma.LeadUncheckedCreateInput),
        updatedAt: context.now,
      },
    });

    await tx.leadTimeline.createMany({
      data: snap.timelines.map(
        (row) =>
          reviveRow(
            row,
            TIMELINE_COLUMNS,
            TIMELINE_DATES,
          ) as Prisma.LeadTimelineCreateManyInput,
      ),
    });
    await tx.leadNote.createMany({
      data: snap.notes.map(
        (row) =>
          reviveRow(
            row,
            NOTE_COLUMNS,
            NOTE_DATES,
          ) as Prisma.LeadNoteCreateManyInput,
      ),
    });
    await tx.leadFollowup.createMany({
      data: snap.followups.map(
        (row) =>
          reviveRow(
            row,
            FOLLOWUP_COLUMNS,
            FOLLOWUP_DATES,
          ) as Prisma.LeadFollowupCreateManyInput,
      ),
    });

    await tx.leadTimeline.create({
      data: {
        leadId: snap.lead.id as string,
        action: LEAD_RESTORED_ACTION,
        remarks: `Lead restored from the Recycle Bin. It had been deleted earlier.`,
        actorId: context.actorId,
        occurredAt: context.now,
      },
    });
  },

  async recordSurvivorRestored(tx, event) {
    // The survivor may itself have been deleted since: then there is no history to tell.
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Lead" WHERE "id" = ${event.survivorId} FOR SHARE
    `;

    if (rows.length === 0) {
      return;
    }

    await tx.leadTimeline.create({
      data: {
        leadId: event.survivorId,
        action: LEAD_DUPLICATE_RESTORED_ACTION,
        remarks: `Lead "${event.restoredLabel}", deleted earlier as a duplicate of this lead, was restored.`,
        actorId: event.actorId,
      },
    });
  },

  // The history entries that named the erased duplicate become neutral; they are found by
  // their exact text, so entries about other duplicates are not touched.
  async redactSurvivorEvents(tx, event) {
    await tx.leadTimeline.updateMany({
      where: {
        leadId: event.survivorId,
        action: LEAD_DUPLICATE_REMOVED_ACTION,
        remarks: `Duplicate lead "${event.removedLabel}" was moved to the Recycle Bin.`,
      },
      data: { remarks: LEAD_DUPLICATE_ERASED_REMARK },
    });
    await tx.leadTimeline.updateMany({
      where: {
        leadId: event.survivorId,
        action: LEAD_DUPLICATE_RESTORED_ACTION,
        remarks: `Lead "${event.removedLabel}", deleted earlier as a duplicate of this lead, was restored.`,
      },
      data: { remarks: LEAD_DUPLICATE_ERASED_REMARK },
    });
  },

  async recordSurvivorEvent(tx, event) {
    await tx.leadTimeline.create({
      data: {
        leadId: event.survivorId,
        action: LEAD_DUPLICATE_REMOVED_ACTION,
        remarks: `Duplicate lead "${event.removedLabel}" was moved to the Recycle Bin.`,
        actorId: event.actorId,
      },
    });
  },
};

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { LEAD_ACTOR_SELECT } from './lead-history.include';

export const LEAD_DEACTIVATED_MESSAGE =
  'This lead is deactivated. Reactivate it to make changes.';

// Lead payload returned by deactivate/reactivate. The assignee and the person
// who deactivated it are exposed as { id, fullName } only.
export const LEAD_LIFECYCLE_INCLUDE = {
  source: true,
  assignedTo: { select: LEAD_ACTOR_SELECT },
  deactivatedBy: { select: LEAD_ACTOR_SELECT },
} satisfies Prisma.LeadInclude;

type LeadDb = Pick<Prisma.TransactionClient, 'lead'>;

// Row locks that make the deactivation rules hold when requests overlap.
//
// Deactivation must not succeed for a lead that gets an opportunity or a
// pending follow-up at the same moment, and those two records must not be
// created for a lead that is being deactivated. So deactivation takes the lead
// row exclusively first, and creating an opportunity or follow-up takes it in
// shared mode in the same transaction as the insert. Whichever side arrives
// second waits, then sees the committed result of the first.
export async function lockLeadForDeactivation(
  tx: Prisma.TransactionClient,
  leadId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Lead"
    WHERE "id" = ${leadId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    throw new NotFoundException('Lead not found.');
  }
}

export async function lockActiveLeadForWrite(
  tx: Prisma.TransactionClient,
  leadId: string,
  notFoundMessage = 'Lead not found.',
) {
  const rows = await tx.$queryRaw<Array<{ isActive: boolean }>>`
    SELECT "isActive"
    FROM "Lead"
    WHERE "id" = ${leadId}
    FOR SHARE
  `;

  if (rows.length === 0) {
    throw new NotFoundException(notFoundMessage);
  }

  if (!rows[0].isActive) {
    throw new ConflictException(LEAD_DEACTIVATED_MESSAGE);
  }
}

// Normal sales writes (edit, activity, assignment, qualification/rejection,
// status, follow-ups, opportunities) must not touch a deactivated lead.
export async function assertLeadActive(db: LeadDb, leadId: string) {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, isActive: true },
  });

  if (!lead) {
    throw new NotFoundException('Lead not found.');
  }

  if (!lead.isActive) {
    throw new ConflictException(LEAD_DEACTIVATED_MESSAGE);
  }
}

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { LEAD_ACTOR_SELECT } from './lead-history.include';

export const LEAD_DEACTIVATED_MESSAGE =
  'This lead is deactivated. Reactivate it to make changes.';

// Lead payload returned by deactivate/reactivate. The assignee and the person
// who deactivated it are exposed as { id, fullName } only.
// The product an enquiry is about, as shown with the lead.
export const LEAD_PRODUCT_SELECT = {
  id: true,
  sku: true,
  productName: true,
  category: true,
} satisfies Prisma.InventoryItemSelect;

export const LEAD_LIFECYCLE_INCLUDE = {
  source: true,
  assignedTo: { select: LEAD_ACTOR_SELECT },
  inventoryItem: { select: LEAD_PRODUCT_SELECT },
  deactivatedBy: { select: LEAD_ACTOR_SELECT },
} satisfies Prisma.LeadInclude;

type LeadDb = Pick<Prisma.TransactionClient, 'lead'>;

// Row locks that make the deactivation and deletion rules hold when requests overlap.
//
// Deactivation must not succeed for a lead that gets an opportunity or a
// pending follow-up at the same moment, and those two records must not be
// created for a lead that is being deactivated. So deactivation takes the lead
// row exclusively first, and creating an opportunity or follow-up takes it in
// shared mode in the same transaction as the insert. Whichever side arrives
// second waits, then sees the committed result of the first.
//
// Deleting a lead (governed deletion) takes the same exclusive lock, so EVERY writer
// of a lead or of the records it owns takes a lock in the same transaction as its
// write: a write that arrives while the lead is being deleted waits, then finds the
// lead gone (404) instead of failing on a foreign key or being lost.
//
// Which lock matters. A writer that only ADDS rows that point at the lead (a follow-up,
// an opportunity, a follow-up change) takes FOR SHARE. A writer that UPDATES the lead
// row itself (edit, activity, status, assignment, qualification, rejection) takes FOR
// NO KEY UPDATE straight away: taking FOR SHARE and then updating is a lock upgrade,
// and two of those on the same lead deadlock (40P01). NO KEY UPDATE is what the update
// would take anyway; it excludes the other writers and the deletion, and still lets the
// foreign-key checks of rows being added to the lead go through.
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

// For a write that is allowed on any lead, active or not (changes to a follow-up that
// already exists): shared lock, and the lead must exist.
export async function lockLeadForWrite(
  tx: Prisma.TransactionClient,
  leadId: string,
  notFoundMessage = 'Lead not found.',
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Lead"
    WHERE "id" = ${leadId}
    FOR SHARE
  `;

  if (rows.length === 0) {
    throw new NotFoundException(notFoundMessage);
  }
}

// For a write that UPDATES the lead row itself, on an active lead: FOR NO KEY UPDATE
// (see above), and the lead must exist and be active.
export async function lockActiveLeadForUpdate(
  tx: Prisma.TransactionClient,
  leadId: string,
  notFoundMessage = 'Lead not found.',
) {
  const rows = await tx.$queryRaw<Array<{ isActive: boolean }>>`
    SELECT "isActive"
    FROM "Lead"
    WHERE "id" = ${leadId}
    FOR NO KEY UPDATE
  `;

  if (rows.length === 0) {
    throw new NotFoundException(notFoundMessage);
  }

  if (!rows[0].isActive) {
    throw new ConflictException(LEAD_DEACTIVATED_MESSAGE);
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

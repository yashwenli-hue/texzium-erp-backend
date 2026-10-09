import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

// Governed data deletion: one model and one service for every kind of record that
// may be deleted and recovered (a lead and a customer). What differs per kind is
// a DeletionPolicy: what blocks the deletion, what is copied into the tombstone, what
// is removed and what the survivor of a duplicate is told. Everything else (the
// reason, the lock, the stale-preview check, the tombstone, the transaction) is here
// and is the same for all of them.

export const DELETION_ENTITY = {
  LEAD: 'LEAD',
  CUSTOMER: 'CUSTOMER',
} as const;

export type DeletionEntityType =
  (typeof DELETION_ENTITY)[keyof typeof DELETION_ENTITY];

export const DELETION_REASON_CODES = [
  'DUPLICATE',
  'ENTERED_IN_ERROR',
  'TEST_DATA',
  'JUNK_OR_SPAM',
  'OTHER',
] as const;

export type DeletionReasonCode = (typeof DELETION_REASON_CODES)[number];

export const DELETION_REASON_MAX_LENGTH = 500;

// DELETED -> RESTORED (the record was put back) or PURGED (erased for good, by an
// administrator at any time or automatically after the recovery window). Both are final.
export const DELETION_STATUS = {
  DELETED: 'DELETED',
  RESTORED: 'RESTORED',
  PURGED: 'PURGED',
} as const;

export type DeletionStatus =
  (typeof DELETION_STATUS)[keyof typeof DELETION_STATUS];

// How long a deleted record can be restored. The deadline is STORED on the tombstone
// (purgeAfter) when the record is deleted, so changing this later never moves the
// deadline of a record that is already in the recycle bin.
//
// The deadline is INCLUSIVE: a record can be restored while now <= purgeAfter. It is
// purged automatically only when now > purgeAfter (strictly after), so at the very
// instant of the deadline a restore still wins. An administrator may purge by hand at any
// time, before, at or after the deadline.
export const RECOVERY_WINDOW_DAYS = 30;

// How a purge came about, kept on the tombstone: an administrator (purgedById = who) or
// the purge worker (a system action, purgedById null). Checked in the database.
export const PURGE_METHOD = {
  MANUAL: 'MANUAL',
  AUTOMATIC: 'AUTOMATIC',
} as const;

export type PurgeMethod = (typeof PURGE_METHOD)[keyof typeof PURGE_METHOD];

export function recoveryDeadline(
  from: Date,
  days: number = RECOVERY_WINDOW_DAYS,
): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export const DELETION_CODE = {
  BLOCKED: 'DELETION_BLOCKED',
  STALE: 'DELETION_STALE',
  RESTORE_BLOCKED: 'RESTORE_BLOCKED',
  RESTORE_STALE: 'RESTORE_STALE',
  RESTORE_WINDOW_EXPIRED: 'RESTORE_WINDOW_EXPIRED',
  ALREADY_RESTORED: 'ALREADY_RESTORED',
  ALREADY_PURGED: 'ALREADY_PURGED',
} as const;

export const DELETION_MESSAGE = {
  STALE:
    'This record changed after you reviewed it. Review it again before deleting.',
  SURVIVOR_ONLY_FOR_DUPLICATE:
    'A surviving record can only be named when the reason is Duplicate.',
  SURVIVOR_IS_SELF: 'A record cannot be a duplicate of itself.',
  REASON_REQUIRED: 'A reason is required.',
  REASON_TOO_LONG: `The reason must be at most ${DELETION_REASON_MAX_LENGTH} characters.`,
  REASON_CODE_UNKNOWN: 'The reason code is not one of the allowed codes.',
  RECORD_NOT_FOUND: 'Deletion record not found.',
  RESTORE_STALE:
    'This record changed after you reviewed it. Review it again before restoring.',
  ALREADY_RESTORED: 'This record has already been restored.',
  ALREADY_PURGED: 'This record has been purged and can no longer be restored.',
  RESTORE_WINDOW_EXPIRED:
    'The recovery period for this record has ended, so it can no longer be restored.',
  NOT_PURGEABLE: 'Only a record that is still deleted can be purged.',
} as const;

// Something that stops a deletion. The message is for the person; the code is for the
// program. `count` is how many records stand in the way.
export interface DeletionBlocker {
  code: string;
  message: string;
  count: number;
  hint?: string;
}

// A kind of record the deletion removes together with the record, and how many.
export interface DeletionLine {
  label: string;
  count: number;
}

export interface DeletionEvaluation {
  label: string;
  code: string | null;
  blockers: DeletionBlocker[];
  removes: DeletionLine[];
  // Changes whenever anything this decision rests on changes (see versionOf).
  version: string;
}

// Anything that can run a query: the client itself (a read) or a transaction.
export type Db = Prisma.TransactionClient;

// What stands in the way of putting a deleted record back.
export interface RestoreConflict {
  code: string;
  message: string;
}

export interface RestoreEvaluation {
  conflicts: RestoreConflict[];
  // What a restore would put back, and how many.
  restores: DeletionLine[];
  // Facts the decision rests on (they go into the restore token).
  facts: Record<string, unknown>;
}

export interface DeletionPolicy {
  entityType: DeletionEntityType;
  // 'lead', 'customer': used inside messages.
  noun: string;
  notFoundMessage: string;
  // Every blocker code this policy can raise, recorded on the tombstone as "checked".
  blockerCodes: readonly string[];

  // Locks the given records exclusively, in id order (so two deletions that name each
  // other cannot deadlock), and returns the ids that exist.
  lockRows(tx: Db, ids: string[]): Promise<string[]>;

  // The decision, from the current state; null when the record does not exist.
  evaluate(db: Db, id: string): Promise<DeletionEvaluation | null>;

  // What to show of a surviving record, or null when it does not exist.
  survivorLabel(db: Db, id: string): Promise<string | null>;

  // The record and everything that is removed with it, in full.
  capture(db: Db, id: string): Promise<Prisma.InputJsonValue>;

  // Removes the record and everything owned by it.
  remove(tx: Db, id: string): Promise<void>;

  // Restore. The snapshot is the one captured at deletion.
  //
  // restoreEvaluate: what would stop the record being recreated now (identity, unique
  // values, things it refers to that no longer exist), and what it would put back.
  restoreEvaluate(
    db: Db,
    snapshot: unknown,
    record: { entityId: string },
  ): Promise<RestoreEvaluation>;

  // Takes whatever lock the conflict checks need, before they run.
  lockForRestore(tx: Db, snapshot: unknown): Promise<void>;

  // Recreates the record and what was removed with it, with their original ids, and
  // writes the history event that says it was restored (neutral: it was deleted earlier
  // and is back. The reason stays in the deletion log, so it is not handed over).
  restore(
    tx: Db,
    snapshot: unknown,
    context: {
      recordId: string;
      actorId: string;
      now: Date;
    },
  ): Promise<void>;

  // Tells the surviving record's history that the duplicate that was deleted is back.
  recordSurvivorRestored(
    tx: Db,
    event: {
      survivorId: string;
      restoredId: string;
      restoredLabel: string;
      actorId: string;
    },
  ): Promise<void>;

  // After a purge: the surviving record's history entries that NAMED the duplicate (that it
  // was moved to the Recycle Bin, or later restored) are made neutral, so the erased
  // record's name does not live on in another record's history. Entries of other
  // duplicates, and every other kind of entry, are left alone.
  redactSurvivorEvents(
    tx: Db,
    event: { survivorId: string; removedLabel: string },
  ): Promise<void>;

  // Tells the surviving record's history that a duplicate was deleted. The history of an
  // ordinary record is read by everyone who can read the record, so it is told THAT the
  // duplicate was moved to the Recycle Bin and never WHY: the reason and the explanation
  // are only in the deletion log (governance.deletions.view). The reason is therefore not
  // handed to the policy at all.
  recordSurvivorEvent(
    tx: Db,
    event: {
      survivorId: string;
      removedId: string;
      removedLabel: string;
      actorId: string;
    },
  ): Promise<void>;
}

export interface DeletionPreview {
  entityType: DeletionEntityType;
  entityId: string;
  label: string;
  code: string | null;
  eligible: boolean;
  blockers: DeletionBlocker[];
  removes: DeletionLine[];
  // What stays: shown to the person before they decide.
  keeps: string[];
  version: string;
  reasonCodes: readonly DeletionReasonCode[];
  // How long the record can be restored after it is deleted.
  recoveryDays: number;
}

export interface RestorePreview {
  id: string;
  entityType: DeletionEntityType;
  // null once the record is purged: the original id and the name were erased with the copy
  entityId: string | null;
  label: string | null;
  status: DeletionStatus;
  deletedAt: Date;
  purgeAfter: Date;
  // The window has ended (judged now, by the server's clock).
  expired: boolean;
  eligible: boolean;
  conflicts: RestoreConflict[];
  restores: DeletionLine[];
  version: string;
}

export interface DeleteRecordInput {
  reasonCode: DeletionReasonCode;
  reason: string;
  duplicateOfId?: string;
  version: string;
}

export interface DeletionResult {
  id: string;
  entityType: DeletionEntityType;
  entityId: string;
  label: string;
  reasonCode: DeletionReasonCode;
  survivorId: string | null;
  deletedAt: Date;
  purgeAfter: Date;
}

export interface RestoreResult {
  id: string;
  entityType: DeletionEntityType;
  entityId: string;
  label: string;
  restoredAt: Date;
}

export interface PurgeResult {
  id: string;
  entityType: DeletionEntityType;
  // no original record id: the purge erases it, and the answer to a purge carries nothing that points back
  purgedAt: Date;
  purgeMethod: PurgeMethod;
}

// What the purge worker did with one tombstone. Nothing here carries the record's name,
// its reason or any of its data: it is what the worker logs.
export type AutoPurgeOutcome =
  // erased: the tombstone is now PURGED (AUTOMATIC)
  | 'PURGED'
  // another transaction (a restore, a manual purge, another worker) holds it: left for the next run
  | 'LOCKED'
  // no longer DELETED when looked at under the lock (restored or purged in the meantime)
  | 'NOT_DELETED'
  // still inside its recovery window when looked at under the lock
  | 'NOT_DUE';

export const DELETION_KEEPS = [
  `The record goes to the Recycle Bin and can be restored by an administrator for ${RECOVERY_WINDOW_DAYS} days. After that its saved copy is erased automatically; an administrator may also erase it earlier.`,
  'A complete copy is kept in the Deletion Log, readable only by administrators.',
] as const;

// A token for the state a deletion decision was made on. It is a digest of facts that
// move whenever the record or anything that decides its eligibility moves; the delete
// carries the token it was shown, and is refused if the state has since changed.
export function versionOf(facts: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.keys(facts)
      .sort()
      .map((key) => [key, facts[key]]),
  );

  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export function describeBlockers(
  noun: string,
  blockers: DeletionBlocker[],
): string {
  return `This ${noun} can't be deleted: ${blockers
    .map((blocker) => blocker.message)
    .join(' ')}`;
}

export function blockedException(
  noun: string,
  blockers: DeletionBlocker[],
): ConflictException {
  return new ConflictException({
    message: describeBlockers(noun, blockers),
    code: DELETION_CODE.BLOCKED,
    blockers,
  });
}

export function staleException(): ConflictException {
  return new ConflictException({
    message: DELETION_MESSAGE.STALE,
    code: DELETION_CODE.STALE,
  });
}

export function restoreBlockedException(
  noun: string,
  conflicts: RestoreConflict[],
): ConflictException {
  return new ConflictException({
    message: `This ${noun} can't be restored: ${conflicts
      .map((conflict) => conflict.message)
      .join(' ')}`,
    code: DELETION_CODE.RESTORE_BLOCKED,
    conflicts,
  });
}

export function restoreStaleException(): ConflictException {
  return new ConflictException({
    message: DELETION_MESSAGE.RESTORE_STALE,
    code: DELETION_CODE.RESTORE_STALE,
  });
}

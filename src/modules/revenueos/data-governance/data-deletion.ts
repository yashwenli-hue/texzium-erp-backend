import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

// Governed data deletion: one model and one service for every kind of record that
// may be permanently deleted (a lead now, a customer next). What differs per kind is
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

export const DELETION_CODE = {
  BLOCKED: 'DELETION_BLOCKED',
  STALE: 'DELETION_STALE',
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

  // Tells the surviving record's history that a duplicate was deleted.
  recordSurvivorEvent(
    tx: Db,
    event: {
      survivorId: string;
      removedId: string;
      removedLabel: string;
      reasonCode: DeletionReasonCode;
      reason: string;
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
}

export const DELETION_KEEPS = [
  'A complete copy of the record is kept in the Deletion Log, readable only by administrators.',
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

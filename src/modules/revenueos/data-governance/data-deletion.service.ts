import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../core/database/prisma.service';
import {
  DELETION_CODE,
  DELETION_KEEPS,
  DELETION_MESSAGE,
  DELETION_REASON_CODES,
  DELETION_REASON_MAX_LENGTH,
  DELETION_STATUS,
  DeleteRecordInput,
  DeletionPolicy,
  DeletionPreview,
  DeletionResult,
  PURGE_METHOD,
  AutoPurgeOutcome,
  PurgeMethod,
  PurgeResult,
  RECOVERY_WINDOW_DAYS,
  RestorePreview,
  RestoreResult,
  blockedException,
  recoveryDeadline,
  restoreBlockedException,
  restoreStaleException,
  staleException,
  versionOf,
} from './data-deletion';
import type { DeletionEntityType, DeletionStatus } from './data-deletion';
import { policyFor } from './deletion-policies';

// The actor shown with a tombstone: id and name only.
const ACTOR_SELECT = { id: true, fullName: true } satisfies Prisma.UserSelect;

// What leaves the API about a tombstone without its snapshot.
const SUMMARY_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  entityCode: true,
  entityLabel: true,
  reasonCode: true,
  reason: true,
  survivorId: true,
  survivorLabel: true,
  impact: true,
  status: true,
  deletedAt: true,
  purgeAfter: true,
  restoredAt: true,
  purgedAt: true,
  purgeMethod: true,
  deletedBy: { select: ACTOR_SELECT },
  restoredBy: { select: ACTOR_SELECT },
  purgedBy: { select: ACTOR_SELECT },
} satisfies Prisma.DataDeletionRecordSelect;

// What a purged tombstone holds in place of the copy it had: a marker, and no impact lines.
// (The database checks the same values: DataDeletionRecord_lifecycle_check and the guard.)
export const PURGED_SNAPSHOT = { purged: true } as const;
export const PURGED_IMPACT = {} as const;

const DELETE_TRANSACTION = {
  // A deletion waits for the rows it locks, so it is given longer than the default.
  maxWait: 10000,
  timeout: 30000,
} as const;

@Injectable()
export class DataDeletionService {
  // `clock` is for tests (the recovery window is judged by it); production uses the
  // server's clock.
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly clock: () => Date = () => new Date(),
  ) {}

  // What a deletion would do, from one consistent view of the data: what stands in the
  // way, what it would remove, what stays, and the token the deletion must carry. It
  // changes nothing and takes no lock.
  async preview(policy: DeletionPolicy, id: string): Promise<DeletionPreview> {
    const evaluation = await this.prisma.$transaction(
      (tx) => policy.evaluate(tx, id),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    if (!evaluation) {
      throw new NotFoundException(policy.notFoundMessage);
    }

    return {
      entityType: policy.entityType,
      entityId: id,
      label: evaluation.label,
      code: evaluation.code,
      eligible: evaluation.blockers.length === 0,
      blockers: evaluation.blockers,
      removes: evaluation.removes,
      keeps: [...DELETION_KEEPS],
      version: evaluation.version,
      reasonCodes: DELETION_REASON_CODES,
      recoveryDays: RECOVERY_WINDOW_DAYS,
    };
  }

  // Deletes one record (it goes to the Recycle Bin and can be restored), in one transaction:
  //
  //   1. lock the record (and the survivor, if one is named), exclusively, in id order.
  //      Every writer of the record takes it in shared mode, so whoever arrives second
  //      waits and then sees what the first committed;
  //   2. re-check every blocker under the lock, so a record that gained a dependency a
  //      moment ago is refused (409) rather than deleted;
  //   3. refuse (409) if the record is not in the state the person reviewed;
  //   4. write the tombstone: a complete copy, the reason, the person;
  //   5. tell the survivor's history, if one was named;
  //   6. remove the record and what it owns.
  //
  // Anything that fails rolls the whole of it back. The foreign keys stay RESTRICT, so a
  // dependency this code did not know about still stops the delete (as an error)
  // instead of being cascaded away.
  async delete(
    policy: DeletionPolicy,
    id: string,
    input: DeleteRecordInput,
    actorId: string | undefined,
  ): Promise<DeletionResult> {
    await this.requireActor(actorId);
    const reason = this.checkReason(input);
    const survivorId = this.checkSurvivor(id, input);

    return this.prisma.$transaction(async (tx) => {
      const locked = await policy.lockRows(
        tx,
        survivorId ? [id, survivorId] : [id],
      );

      if (!locked.includes(id)) {
        throw new NotFoundException(policy.notFoundMessage);
      }

      if (survivorId && !locked.includes(survivorId)) {
        throw new BadRequestException(
          `The surviving ${policy.noun} was not found. It may have been deleted.`,
        );
      }

      const evaluation = await policy.evaluate(tx, id);

      if (!evaluation) {
        throw new NotFoundException(policy.notFoundMessage);
      }

      if (evaluation.blockers.length > 0) {
        throw blockedException(policy.noun, evaluation.blockers);
      }

      if (evaluation.version !== input.version) {
        throw staleException();
      }

      const survivorLabel = survivorId
        ? await policy.survivorLabel(tx, survivorId)
        : null;

      const snapshot = await policy.capture(tx, id);

      const deletedAt = this.clock();

      const tombstone = await tx.dataDeletionRecord.create({
        data: {
          deletedAt,
          purgeAfter: recoveryDeadline(deletedAt),
          entityType: policy.entityType,
          entityId: id,
          entityCode: evaluation.code,
          entityLabel: evaluation.label,
          reasonCode: input.reasonCode,
          reason,
          survivorId: survivorId ?? null,
          survivorLabel,
          snapshot,
          impact: {
            removed: evaluation.removes,
            blockersChecked: [...policy.blockerCodes],
            version: evaluation.version,
          } as unknown as Prisma.InputJsonValue,
          deletedById: actorId as string,
        },
        select: { id: true, deletedAt: true, purgeAfter: true },
      });

      if (survivorId) {
        await policy.recordSurvivorEvent(tx, {
          survivorId,
          removedId: id,
          removedLabel: evaluation.label,
          actorId: actorId as string,
        });
      }

      try {
        await policy.remove(tx, id);
      } catch (error) {
        // The foreign keys are the backstop: something that refers to the record and
        // was not in the blockers (a dependency added after this code, or one that
        // arrived without taking the lock) stops the delete as a refusal, and the
        // transaction, tombstone included, is rolled back.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        ) {
          throw blockedException(policy.noun, [
            {
              code: DELETION_CODE.BLOCKED,
              count: 1,
              message: `Other records still refer to this ${policy.noun}. Nothing was deleted.`,
            },
          ]);
        }

        throw error;
      }

      return {
        id: tombstone.id,
        entityType: policy.entityType,
        entityId: id,
        label: evaluation.label,
        reasonCode: input.reasonCode,
        survivorId: survivorId ?? null,
        deletedAt: tombstone.deletedAt,
        purgeAfter: tombstone.purgeAfter,
      };
    }, DELETE_TRANSACTION);
  }

  // The deletion log / recycle bin: newest first, without the snapshots (they are large
  // and hold personal data; read one record to get its snapshot). `recoverable` is judged
  // now, by the server's clock: still DELETED and inside its window.
  async list(query: {
    entityType?: DeletionEntityType;
    entityId?: string;
    status?: DeletionStatus;
    limit?: number;
    offset?: number;
  }) {
    const where: Prisma.DataDeletionRecordWhereInput = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const rows = await this.prisma.dataDeletionRecord.findMany({
      where,
      orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      skip: query.offset ?? 0,
      select: SUMMARY_SELECT,
    });

    return rows.map((row) => this.withWindow(row));
  }

  async findOne(id: string) {
    const record = await this.prisma.dataDeletionRecord.findUnique({
      where: { id },
      select: { ...SUMMARY_SELECT, snapshot: true },
    });

    if (!record) {
      throw new NotFoundException(DELETION_MESSAGE.RECORD_NOT_FOUND);
    }

    return this.withWindow(record);
  }

  // What restoring this record would do, from one consistent view: whether it can be
  // restored now, what stands in the way, what it would put back, and the token the
  // restore must carry. Changes nothing and takes no lock.
  async restorePreview(id: string): Promise<RestorePreview> {
    const preview = await this.prisma.$transaction(
      (tx) => this.evaluateRestore(tx, id),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return preview.preview;
  }

  // Puts a deleted record back, in one transaction:
  //
  //   1. lock the tombstone (two restores of one record are one after the other);
  //   2. it must still be DELETED and inside its window;
  //   3. lock what the checks need, then re-check every conflict (identity, unique
  //      values, things the record refers to that may have gone) under that lock;
  //   4. refuse (409) if it is not in the state the person reviewed;
  //   5. recreate the record and what was removed with it, with their original ids;
  //   6. tell the survivor's history, if there was one, and finish the tombstone.
  //
  // Anything that fails rolls everything back: nothing is half restored. The unique
  // indexes and foreign keys are the backstop for a conflict that arrives after the
  // checks; it is a refusal (409), never a 500.
  async restore(
    id: string,
    input: { version: string },
    actorId: string | undefined,
  ): Promise<RestoreResult> {
    await this.requireActor(actorId);

    return this.prisma.$transaction(async (tx) => {
      await this.lockTombstone(tx, id);

      const record = await tx.dataDeletionRecord.findUniqueOrThrow({
        where: { id },
      });
      const policy = policyFor(record.entityType);
      const now = this.clock();

      this.assertRestorable(
        record.status as DeletionStatus,
        now.getTime() > record.purgeAfter.getTime(),
      );

      await policy.lockForRestore(tx, record.snapshot);
      // a DELETED row always has its original id (only a purge erases it)
      const checked = await policy.restoreEvaluate(tx, record.snapshot, {
        entityId: record.entityId as string,
      });

      if (checked.conflicts.length > 0) {
        throw restoreBlockedException(policy.noun, checked.conflicts);
      }

      if (input.version !== this.restoreVersion(record, checked)) {
        throw restoreStaleException();
      }

      try {
        await policy.restore(tx, record.snapshot, {
          recordId: record.id,
          actorId: actorId as string,
          now,
        });

        if (record.survivorId) {
          await policy.recordSurvivorRestored(tx, {
            survivorId: record.survivorId,
            restoredId: record.entityId as string,
            restoredLabel: record.entityLabel as string, // a DELETED row always has its name
            actorId: actorId as string,
          });
        }
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' || error.code === 'P2003')
        ) {
          throw restoreBlockedException(policy.noun, [
            {
              code: DELETION_CODE.RESTORE_BLOCKED,
              message: `Something changed while the ${policy.noun} was being restored. Nothing was restored.`,
            },
          ]);
        }

        throw error;
      }

      await tx.dataDeletionRecord.update({
        where: { id },
        data: {
          status: DELETION_STATUS.RESTORED,
          restoredAt: now,
          restoredById: actorId as string,
        },
      });

      return {
        id,
        entityType: record.entityType as DeletionEntityType,
        entityId: record.entityId as string, // a DELETED row has its original id
        label: record.entityLabel as string, // restoring needs a DELETED row, which always has its name
        restoredAt: now,
      };
    }, DELETE_TRANSACTION);
  }

  // Erases the record's copy, by hand, for good: the tombstone stays, as PURGED
  // (MANUAL), with who and when, and the record can then never be restored. An
  // administrator may do this at any time, inside the recovery window or after it; the
  // route is guarded by governance.deletions.view AND governance.deletions.purge, and the
  // caller is the one who is recorded.
  //
  // It locks the tombstone (FOR UPDATE), so a restore, another manual purge and the purge
  // worker are one after the other, and the update only applies to a row that is still
  // DELETED: whichever got the lock first wins, and the others find the record RESTORED or
  // PURGED and are refused (409), never half done.
  async purge(id: string, actorId: string | undefined): Promise<PurgeResult> {
    await this.requireActor(actorId);

    return this.prisma.$transaction(async (tx) => {
      await this.lockTombstone(tx, id);

      const record = await tx.dataDeletionRecord.findUniqueOrThrow({
        where: { id },
        select: { entityType: true, status: true },
      });

      if (record.status === DELETION_STATUS.PURGED) {
        throw this.conflict(
          DELETION_MESSAGE.ALREADY_PURGED,
          DELETION_CODE.ALREADY_PURGED,
        );
      }

      if (record.status !== DELETION_STATUS.DELETED) {
        throw this.conflict(
          DELETION_MESSAGE.NOT_PURGEABLE,
          DELETION_CODE.ALREADY_RESTORED,
        );
      }

      const now = this.clock();
      const erased = await this.erase(tx, id, {
        method: PURGE_METHOD.MANUAL,
        actorId: actorId as string,
        now,
      });

      if (!erased) {
        throw this.conflict(
          DELETION_MESSAGE.NOT_PURGEABLE,
          DELETION_CODE.ALREADY_PURGED,
        );
      }

      // Nothing that identifies the record is returned: its name is gone with the copy.
      return {
        id,
        entityType: record.entityType as DeletionEntityType,
        purgedAt: now,
        purgeMethod: PURGE_METHOD.MANUAL,
      };
    }, DELETE_TRANSACTION);
  }

  // The purge worker's side. The ids of tombstones whose recovery window has ended
  // (still DELETED and now > the STORED purgeAfter), oldest deadline first, after the
  // given position, at most `limit` of them: a page, never the whole backlog. It only
  // proposes; each one is judged again under its own lock by purgeExpired.
  async findExpiredTombstones(
    limit: number,
    after?: { purgeAfter: Date; id: string },
  ): Promise<Array<{ id: string; entityType: string; purgeAfter: Date }>> {
    const now = this.clock();

    return this.prisma.dataDeletionRecord.findMany({
      where: {
        status: DELETION_STATUS.DELETED,
        purgeAfter: { lt: now },
        ...(after
          ? {
              OR: [
                { purgeAfter: { gt: after.purgeAfter } },
                { purgeAfter: after.purgeAfter, id: { gt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ purgeAfter: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true, entityType: true, purgeAfter: true },
    });
  }

  // Erases one tombstone whose recovery window has ended, as a system action (AUTOMATIC,
  // no actor), in its own short transaction:
  //
  //   1. take the row lock with SKIP LOCKED: if a restore, a manual purge or another
  //      worker holds it, leave it (LOCKED), the next run looks again;
  //   2. under the lock, look again: still DELETED, and now > the STORED purgeAfter (the
  //      deadline itself is still inside the recovery window, so a restore at the deadline
  //      wins), otherwise nothing is done;
  //   3. a conditional update (only a row that is still DELETED), through the same
  //      lifecycle trigger and CHECKs as every other transition (the database refuses an
  //      automatic purge at or before the deadline by itself).
  //
  // Failure rolls the transaction back and throws: the tombstone stays DELETED and is
  // found again by the next run. A record restored before this transaction got the lock
  // is RESTORED and is never purged.
  async purgeExpired(id: string): Promise<AutoPurgeOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "DataDeletionRecord"
        WHERE "id" = ${id} FOR UPDATE SKIP LOCKED
      `;

      if (locked.length === 0) {
        const exists = await tx.dataDeletionRecord.count({ where: { id } });

        // Gone is not an error (nothing to do); held by someone is a skip.
        return exists === 0 ? 'NOT_DELETED' : 'LOCKED';
      }

      const record = await tx.dataDeletionRecord.findUniqueOrThrow({
        where: { id },
        select: { status: true, purgeAfter: true },
      });

      if (record.status !== DELETION_STATUS.DELETED) {
        return 'NOT_DELETED';
      }

      const now = this.clock();

      if (now.getTime() <= record.purgeAfter.getTime()) {
        return 'NOT_DUE';
      }

      const erased = await this.erase(tx, id, {
        method: PURGE_METHOD.AUTOMATIC,
        actorId: null,
        now,
      });

      return erased ? 'PURGED' : 'NOT_DELETED';
    }, DELETE_TRANSACTION);
  }

  // The one place a tombstone is purged, for both paths, inside the caller's transaction and
  // under its row lock. In ONE statement (the lifecycle trigger refuses anything less) the
  // copy and everything that only served recovery is erased: snapshot, impact, the free-text
  // reason, the name and code, the ORIGINAL id of the lead or customer, the surviving record
  // named for a duplicate, and who deleted it. What stays is the minimal audit: the
  // tombstone's own id, type, reason code, when it was deleted, the stored deadline, when it
  // was purged, how, and by whom (a person for a manual purge, nobody for the system). The
  // record's name is first scrubbed from the surviving record's history. Returns false when the
  // row was no longer DELETED (nothing was changed).
  private async erase(
    tx: Prisma.TransactionClient,
    id: string,
    how: { method: PurgeMethod; actorId: string | null; now: Date },
  ): Promise<boolean> {
    const record = await tx.dataDeletionRecord.findUniqueOrThrow({
      where: { id },
      select: { entityType: true, entityLabel: true, survivorId: true },
    });

    const done = await tx.dataDeletionRecord.updateMany({
      where: { id, status: DELETION_STATUS.DELETED },
      data: {
        status: DELETION_STATUS.PURGED,
        purgedAt: how.now,
        purgedById: how.actorId,
        purgeMethod: how.method,
        snapshot: PURGED_SNAPSHOT,
        impact: PURGED_IMPACT,
        entityId: null,
        entityCode: null,
        entityLabel: null,
        reason: null,
        survivorId: null,
        survivorLabel: null,
        deletedById: null,
      },
    });

    if (done.count !== 1) {
      return false;
    }

    if (record.survivorId && record.entityLabel) {
      await policyFor(record.entityType).redactSurvivorEvents(tx, {
        survivorId: record.survivorId,
        removedLabel: record.entityLabel,
      });
    }

    return true;
  }

  private conflict(
    message: string,
    code: string,
    extra: Record<string, unknown> = {},
  ) {
    return new ConflictException({ message, code, ...extra });
  }

  private withWindow<T extends { status: string; purgeAfter: Date }>(
    row: T,
  ): T & { recoverable: boolean; expired: boolean } {
    const expired = this.clock().getTime() > row.purgeAfter.getTime();

    return {
      ...row,
      expired,
      recoverable: row.status === DELETION_STATUS.DELETED && !expired,
    };
  }

  private async lockTombstone(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "DataDeletionRecord" WHERE "id" = ${id} FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new NotFoundException(DELETION_MESSAGE.RECORD_NOT_FOUND);
    }
  }

  private assertRestorable(status: DeletionStatus, expired: boolean) {
    if (status === DELETION_STATUS.RESTORED) {
      throw this.conflict(
        DELETION_MESSAGE.ALREADY_RESTORED,
        DELETION_CODE.ALREADY_RESTORED,
      );
    }

    if (status === DELETION_STATUS.PURGED) {
      throw this.conflict(
        DELETION_MESSAGE.ALREADY_PURGED,
        DELETION_CODE.ALREADY_PURGED,
      );
    }

    if (expired) {
      throw this.conflict(
        DELETION_MESSAGE.RESTORE_WINDOW_EXPIRED,
        DELETION_CODE.RESTORE_WINDOW_EXPIRED,
      );
    }
  }

  // The token a restore carries: the record's state (status, deadline) and every fact
  // the conflict checks rest on. `expired` is deliberately not in it: crossing the
  // deadline is a refusal of its own.
  private restoreVersion(
    record: { status: string; purgeAfter: Date },
    evaluation: { conflicts: unknown[]; facts: Record<string, unknown> },
  ): string {
    return versionOf({
      status: record.status,
      purgeAfter: record.purgeAfter.toISOString(),
      conflicts: evaluation.conflicts,
      ...evaluation.facts,
    });
  }

  private async evaluateRestore(db: Prisma.TransactionClient, id: string) {
    const record = await db.dataDeletionRecord.findUnique({ where: { id } });

    if (!record) {
      throw new NotFoundException(DELETION_MESSAGE.RECORD_NOT_FOUND);
    }

    const policy = policyFor(record.entityType);
    const expired = this.clock().getTime() > record.purgeAfter.getTime();
    const base = {
      id: record.id,
      entityType: record.entityType as DeletionEntityType,
      entityId: record.entityId,
      label: record.entityLabel,
      status: record.status as DeletionStatus,
      deletedAt: record.deletedAt,
      purgeAfter: record.purgeAfter,
      expired,
    };

    // A record that is not DELETED has nothing to restore: say why, without reading a
    // snapshot (a purged one is only a marker).
    if (record.status !== DELETION_STATUS.DELETED) {
      const preview: RestorePreview = {
        ...base,
        eligible: false,
        conflicts: [
          record.status === DELETION_STATUS.RESTORED
            ? {
                code: DELETION_CODE.ALREADY_RESTORED,
                message: DELETION_MESSAGE.ALREADY_RESTORED,
              }
            : {
                code: DELETION_CODE.ALREADY_PURGED,
                message: DELETION_MESSAGE.ALREADY_PURGED,
              },
        ],
        restores: [],
        version: this.restoreVersion(record, { conflicts: [], facts: {} }),
      };

      return { preview };
    }

    const restoreEvaluation = await policy.restoreEvaluate(
      db,
      record.snapshot,
      {
        entityId: record.entityId as string, // not purged here, so it still has its id
      },
    );

    const conflicts = expired
      ? [
          {
            code: DELETION_CODE.RESTORE_WINDOW_EXPIRED,
            message: DELETION_MESSAGE.RESTORE_WINDOW_EXPIRED,
          },
          ...restoreEvaluation.conflicts,
        ]
      : restoreEvaluation.conflicts;

    const preview: RestorePreview = {
      ...base,
      eligible: conflicts.length === 0,
      conflicts,
      restores: restoreEvaluation.restores,
      version: this.restoreVersion(record, restoreEvaluation),
    };

    return { preview };
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
      throw new UnauthorizedException('Authenticated user required.');
    }
  }

  // The reason is checked here too, not only by the DTO, so no caller can store a
  // tombstone without one.
  private checkReason(input: DeleteRecordInput): string {
    if (!DELETION_REASON_CODES.includes(input.reasonCode)) {
      throw new BadRequestException(DELETION_MESSAGE.REASON_CODE_UNKNOWN);
    }

    const reason = (input.reason ?? '').trim();

    if (reason === '') {
      throw new BadRequestException(DELETION_MESSAGE.REASON_REQUIRED);
    }

    if (reason.length > DELETION_REASON_MAX_LENGTH) {
      throw new BadRequestException(DELETION_MESSAGE.REASON_TOO_LONG);
    }

    return reason;
  }

  private checkSurvivor(
    id: string,
    input: DeleteRecordInput,
  ): string | undefined {
    if (!input.duplicateOfId) {
      return undefined;
    }

    if (input.reasonCode !== 'DUPLICATE') {
      throw new BadRequestException(
        DELETION_MESSAGE.SURVIVOR_ONLY_FOR_DUPLICATE,
      );
    }

    if (input.duplicateOfId === id) {
      throw new BadRequestException(DELETION_MESSAGE.SURVIVOR_IS_SELF);
    }

    return input.duplicateOfId;
  }
}

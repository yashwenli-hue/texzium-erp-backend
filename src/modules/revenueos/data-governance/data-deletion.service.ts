import {
  BadRequestException,
  Injectable,
  NotFoundException,
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
  DeleteRecordInput,
  DeletionPolicy,
  DeletionPreview,
  DeletionResult,
  blockedException,
  staleException,
} from './data-deletion';
import type { DeletionEntityType } from './data-deletion';

// The actor shown with a tombstone: id and name only.
const ACTOR_SELECT = { id: true, fullName: true } satisfies Prisma.UserSelect;

const DELETE_TRANSACTION = {
  // A deletion waits for the rows it locks, so it is given longer than the default.
  maxWait: 10000,
  timeout: 30000,
} as const;

@Injectable()
export class DataDeletionService {
  constructor(private readonly prisma: PrismaService) {}

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
    };
  }

  // Permanently deletes one record, in one transaction:
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

      const tombstone = await tx.dataDeletionRecord.create({
        data: {
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
        select: { id: true, deletedAt: true },
      });

      if (survivorId) {
        await policy.recordSurvivorEvent(tx, {
          survivorId,
          removedId: id,
          removedLabel: evaluation.label,
          reasonCode: input.reasonCode,
          reason,
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
      };
    }, DELETE_TRANSACTION);
  }

  // The deletion log: newest first, without the snapshots (they are large and hold
  // personal data; read one record to get its snapshot).
  async list(query: {
    entityType?: DeletionEntityType;
    entityId?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Prisma.DataDeletionRecordWhereInput = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };

    return this.prisma.dataDeletionRecord.findMany({
      where,
      orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      skip: query.offset ?? 0,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        entityCode: true,
        entityLabel: true,
        reasonCode: true,
        reason: true,
        survivorId: true,
        survivorLabel: true,
        deletedAt: true,
        deletedBy: { select: ACTOR_SELECT },
      },
    });
  }

  async findOne(id: string) {
    const record = await this.prisma.dataDeletionRecord.findUnique({
      where: { id },
      include: { deletedBy: { select: ACTOR_SELECT } },
    });

    if (!record) {
      throw new NotFoundException('Deletion record not found.');
    }

    return record;
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

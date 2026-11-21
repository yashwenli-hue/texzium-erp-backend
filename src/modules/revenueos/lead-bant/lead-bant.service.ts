import { Injectable, UnauthorizedException } from '@nestjs/common';
import { LeadBant, LeadTimelineSource } from '@prisma/client';

import { PrismaService } from '../../../core/database/prisma.service';
import { lockActiveLeadForWrite } from '../leads/lead-lifecycle';
import {
  BANT_GRADE_LABEL,
  BANT_KEYS,
  BANT_QUESTIONS,
  BantAnswers,
  bantGrade,
  bantMissing,
  bantScore,
  isBantComplete,
} from './bant-questions';
import { SaveLeadBantDto } from './dto/save-lead-bant.dto';

export const BANT_UPDATED_ACTION = 'BANT_UPDATED';

const NOTE_KEYS = [
  'budgetNote',
  'authorityNote',
  'needNote',
  'timelineNote',
] as const;

/** What the API returns for a lead's BANT: the questions, the answers, and the result. */
export function bantView(row: LeadBant | null) {
  const answers: BantAnswers = row ?? {};
  const score = row?.score ?? 0;
  const complete = isBantComplete(answers);
  return {
    questions: BANT_QUESTIONS,
    answers: {
      budget: row?.budget ?? null,
      authority: row?.authority ?? null,
      need: row?.need ?? null,
      timeline: row?.timeline ?? null,
      budgetAmount: row?.budgetAmount ?? null,
      budgetNote: row?.budgetNote ?? null,
      authorityNote: row?.authorityNote ?? null,
      needNote: row?.needNote ?? null,
      timelineNote: row?.timelineNote ?? null,
    },
    score,
    grade: complete ? bantGrade(score) : null,
    complete,
    missing: bantMissing(answers),
    completedAt: row?.completedAt ?? null,
    updatedAt: row?.updatedAt ?? null,
    updatedById: row?.updatedById ?? null,
  };
}

const blankToNull = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim();

@Injectable()
export class LeadBantService {
  constructor(private readonly prisma: PrismaService) {}

  async get(leadId: string) {
    const row = await this.prisma.leadBant.findUnique({ where: { leadId } });
    return bantView(row);
  }

  // Saves what is answered so far (a field left out keeps its saved value; null clears
  // it), works out the score, and records one BANT_UPDATED history event, all in one
  // transaction on an active lead.
  async save(
    leadId: string,
    data: SaveLeadBantDto,
    actorId: string | undefined,
  ) {
    if (!actorId) {
      throw new UnauthorizedException('Authenticated user required.');
    }

    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForWrite(tx, leadId);
      const current = await tx.leadBant.findUnique({ where: { leadId } });

      const next: Record<string, unknown> = {};
      for (const key of BANT_KEYS) {
        next[key] =
          data[key] === undefined ? (current?.[key] ?? null) : data[key];
      }
      for (const key of NOTE_KEYS) {
        const v = blankToNull(data[key]);
        next[key] = v === undefined ? (current?.[key] ?? null) : v;
      }
      next.budgetAmount =
        data.budgetAmount === undefined
          ? (current?.budgetAmount ?? null)
          : data.budgetAmount;

      const answers = next as BantAnswers;
      const score = bantScore(answers);
      const complete = isBantComplete(answers);
      const completedAt = complete
        ? (current?.completedAt ?? new Date())
        : null;

      const fields = {
        ...(next as Omit<
          LeadBant,
          | 'id'
          | 'leadId'
          | 'score'
          | 'completedAt'
          | 'updatedById'
          | 'createdAt'
          | 'updatedAt'
        >),
        score,
        completedAt,
        updatedById: actorId,
      };

      const row = await tx.leadBant.upsert({
        where: { leadId },
        create: { leadId, ...fields },
        update: fields,
      });

      const missing = bantMissing(answers);
      await tx.leadTimeline.create({
        data: {
          leadId,
          action: BANT_UPDATED_ACTION,
          remarks: complete
            ? `BANT completed: score ${score}/100 (${BANT_GRADE_LABEL[bantGrade(score)]}).`
            : `BANT updated: score ${score}/100 so far; still to answer: ${missing.join(', ')}.`,
          source: LeadTimelineSource.SYSTEM,
          actorId,
        },
      });

      return bantView(row);
    });
  }
}

import { Prisma } from '@prisma/client';

// Only these User fields ever leave the API as an activity actor.
export const LEAD_ACTOR_SELECT = {
  id: true,
  fullName: true,
} satisfies Prisma.UserSelect;

// A lead's BANT result as lists and the lead detail carry it (the answers themselves
// come from GET /leads/:id/bant).
export const LEAD_BANT_SUMMARY_SELECT = {
  score: true,
  completedAt: true,
} satisfies Prisma.LeadBantSelect;

// Deterministic, newest-first history: when it happened, then when it was
// recorded, then id as a stable tiebreaker.
export const LEAD_HISTORY_INCLUDE = {
  notes: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  },
  timelines: {
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    include: {
      actor: { select: LEAD_ACTOR_SELECT },
    },
  },
} satisfies Prisma.LeadInclude;

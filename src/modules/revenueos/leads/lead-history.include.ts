import { Prisma } from '@prisma/client';

// Only these User fields ever leave the API as an activity actor.
export const LEAD_ACTOR_SELECT = {
  id: true,
  fullName: true,
} satisfies Prisma.UserSelect;

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

import { BadRequestException } from '@nestjs/common';

/** The longest window one calendar request may cover (a month view plus its edges). */
export const MAX_RANGE_DAYS = 62;

const DAY_MS = 24 * 60 * 60 * 1000;

function parseInstant(value: unknown, name: string): Date {
  if (typeof value !== 'string' || value.trim() === '')
    throw new BadRequestException(`${name} is required (an ISO date-time).`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime()))
    throw new BadRequestException(`${name} is not a valid date-time.`);
  return d;
}

/** `from` and `to` of a follow-up list: both required, `to` after `from`, at most MAX_RANGE_DAYS apart. */
export function parseFollowupRange(
  from: unknown,
  to: unknown,
): { from: Date; to: Date } {
  const f = parseInstant(from, 'from');
  const t = parseInstant(to, 'to');
  if (t.getTime() <= f.getTime())
    throw new BadRequestException('to must be after from.');
  if (t.getTime() - f.getTime() > MAX_RANGE_DAYS * DAY_MS)
    throw new BadRequestException(
      `The range may cover at most ${MAX_RANGE_DAYS} days.`,
    );
  return { from: f, to: t };
}

/** What one follow-up shows in the reminder popup and on the calendar. */
export const FOLLOWUP_CALENDAR_SELECT = {
  id: true,
  followupDate: true,
  remarks: true,
  status: true,
  completedAt: true,
  completedBy: { select: { id: true, fullName: true } },
  lead: {
    select: {
      id: true,
      leadCode: true,
      customerName: true,
      companyName: true,
      phone: true,
      status: true,
      isActive: true,
      assignedTo: { select: { id: true, fullName: true } },
    },
  },
} as const;

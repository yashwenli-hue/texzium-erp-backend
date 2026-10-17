import {
  LEAD_STAGE_KEYS,
  LeadStage,
} from '../../lead-assignments/lead-transitions';
import { LeadStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// GET /leads/search — the Leads list and the Pre-Sales panel, filtered, sorted and paged
// on the server. A list value may be repeated (?status=NEW&status=CONTACTED) or given
// comma-separated (?status=NEW,CONTACTED).

const list = ({ value }: { value: unknown }): unknown => {
  const raw: unknown[] = Array.isArray(value)
    ? (value as unknown[])
    : value === undefined
      ? []
      : [value];
  const items: unknown[] = raw
    .flatMap((v): unknown[] => (typeof v === 'string' ? v.split(',') : [v]))
    .map((v) => (typeof v === 'string' ? v.trim() : v))
    .filter((v) => v !== '');
  return items.length ? items : undefined;
};
const bool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;
const int = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
const text = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? undefined : t;
};

export const LEAD_SEARCH_SORTS = [
  'customerName',
  'createdAt',
  'lastActivityAt',
] as const;
export const FOLLOWUP_URGENCIES = [
  'Overdue',
  'Due Today',
  'Tomorrow',
  'Scheduled',
  'None',
] as const;
export const LAST_CALL_FILTERS = ['CNC', 'CONNECTED', 'NONE'] as const;
export const NOT_SET = 'NOT_SET';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID_LIKE = /^[0-9a-fA-F-]{8,64}$/;

export class SearchLeadsQueryDto {
  // Name, company, email, place, lead code or the assignee's name; a phone number in any
  // format (spaces, hyphens, brackets, +91 / 0 prefixes): see lead-search.ts.
  @IsOptional()
  @Transform(text)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Transform(list)
  @IsEnum(LeadStatus, { each: true })
  status?: LeadStatus[];

  /** Lifecycle stages (lead-transitions.ts LEAD_STAGES), each a group of statuses. */
  @IsOptional()
  @Transform(list)
  @IsIn(LEAD_STAGE_KEYS, { each: true })
  stage?: LeadStage[];

  @IsOptional()
  @IsIn(['assigned', 'unassigned'])
  assignment?: 'assigned' | 'unassigned';

  /** The person the lead is assigned to now. */
  @IsOptional()
  @Matches(UUID_LIKE)
  assignedToId?: string;

  /** Someone who did pre-sales work on the lead, now or before (lead-search.ts). */
  @IsOptional()
  @Transform(list)
  @Matches(UUID_LIKE, { each: true })
  presalesUserId?: string[];

  /** The sales person who holds the lead now (after qualification). */
  @IsOptional()
  @Transform(list)
  @Matches(UUID_LIKE, { each: true })
  salesUserId?: string[];

  @IsOptional()
  @Transform(list)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  source?: string[];

  /** Inventory item ids of the product an enquiry is about; NOT_SET for none recorded. */
  @IsOptional()
  @Transform(list)
  @Matches(/^([0-9a-fA-F-]{36}|NOT_SET)$/, { each: true })
  product?: string[];

  /** ISO country codes; NOT_SET for leads without a location. */
  @IsOptional()
  @Transform(list)
  @Matches(/^([A-Z]{2}|NOT_SET)$/, { each: true })
  country?: string[];

  @IsOptional()
  @Transform(list)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  state?: string[];

  @IsOptional()
  @Transform(list)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  city?: string[];

  @IsOptional()
  @Transform(list)
  @IsIn(FOLLOWUP_URGENCIES, { each: true })
  followup?: (typeof FOLLOWUP_URGENCIES)[number][];

  /** The outcome of the lead's latest logged call: CNC (not connected), CONNECTED, or NONE. */
  @IsOptional()
  @Transform(list)
  @IsIn(LAST_CALL_FILTERS, { each: true })
  lastCall?: (typeof LAST_CALL_FILTERS)[number][];

  /** Received from / to, inclusive, as calendar days in India (IST). */
  @IsOptional()
  @Matches(DAY)
  createdFrom?: string;

  @IsOptional()
  @Matches(DAY)
  createdTo?: string;

  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  includeInactive?: boolean;

  @IsOptional()
  @IsIn(LEAD_SEARCH_SORTS)
  sort?: (typeof LEAD_SEARCH_SORTS)[number];

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  @IsOptional()
  @Transform(int)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(int)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

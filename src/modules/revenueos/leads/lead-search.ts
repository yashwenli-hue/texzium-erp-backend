import { LeadStatus, Prisma, PrismaClient } from '@prisma/client';

import { RecordScope, leadVisibleSql } from '../record-scope/record-scope';
import { LEAD_BEFORE_QUALIFICATION } from '../lead-assignments/lead-transitions';
import { NOT_SET, SearchLeadsQueryDto } from './dto/search-leads-query.dto';
import { LEAD_ACTOR_SELECT } from './lead-history.include';

// Server-side lead search: one WHERE built from the query, applied to the page, the total
// and every facet, always inside the caller's record scope (record-scope.ts). Nothing
// outside the scope is counted, suggested or returned.
//
// PHONE NUMBERS. A query made only of digits and phone punctuation (+ - . ( ) spaces)
// with at least 4 digits is a phone search, compared on digits only against the phone and
// the alternate phone:
//   10 digits or more  the last 10 digits must be equal (so +91 98765 43210, 098765 43210
//                      and 9876543210 are the same number)
//   4 to 9 digits      the digits appear anywhere in the number
// Any other query is a text search (name, company, email, place, lead code, assignee);
// it also matches phone digits when it contains 4 or more of them.
//
// PRE-SALES INVOLVEMENT ("who worked on the lead in pre-sales"), from recorded ids only,
// never from names in history text:
//   - the current assignee while the lead is before qualification
//   - the person named (subjectUserId) on a PRE_SALES_ASSIGNED event (recorded from the
//     lifecycle v2 release on; older assignments are not reconstructed)
//   - whoever qualified it (LEAD_QUALIFIED actor)
//   - whoever logged an activity, moved its status or rejected it before it was first
//     qualified, or completed one of its follow-ups before then
// Current SALES ownership is separate: the assignee of a lead that has been qualified and
// is not back before qualification.

const PRE_QUAL: readonly LeadStatus[] = LEAD_BEFORE_QUALIFICATION;
const TZ = 'Asia/Kolkata';
const DIGITS_RE = /\D+/g;
const PHONE_LIKE = /^[+\d\s().-]+$/;

const sqlList = (values: readonly string[]) =>
  Prisma.join(values.map((v) => Prisma.sql`${v}`));
const statusList = (values: readonly string[]) =>
  Prisma.join(values.map((v) => Prisma.sql`${v}::"LeadStatus"`));
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** (leadId, userId) for every pre-sales involvement, over all leads (see the header). */
const PRESALES_PAIRS = Prisma.sql`
  SELECT l."id" AS "leadId", l."assignedToId" AS "userId" FROM "Lead" l
   WHERE l."assignedToId" IS NOT NULL AND l."status" IN (${statusList(PRE_QUAL)})
  UNION
  SELECT t."leadId", t."subjectUserId" FROM "LeadTimeline" t
   WHERE t."action" = 'PRE_SALES_ASSIGNED' AND t."subjectUserId" IS NOT NULL
  UNION
  SELECT t."leadId", t."actorId" FROM "LeadTimeline" t
   WHERE t."actorId" IS NOT NULL
     AND (t."action" = 'LEAD_QUALIFIED'
          OR ((t."source" = 'EMPLOYEE' OR t."action" IN ('STATUS_UPDATED', 'LEAD_REJECTED'))
              AND NOT EXISTS (SELECT 1 FROM "LeadTimeline" q
                               WHERE q."leadId" = t."leadId" AND q."action" = 'LEAD_QUALIFIED'
                                 AND q."occurredAt" <= t."occurredAt")))
  UNION
  SELECT f."leadId", f."completedById" FROM "LeadFollowup" f
   WHERE f."completedById" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "LeadTimeline" q
                      WHERE q."leadId" = f."leadId" AND q."action" = 'LEAD_QUALIFIED'
                        AND q."occurredAt" <= COALESCE(f."completedAt", f."updatedAt"))
`;

/** The lead's sales owner now (null before qualification). */
const SALES_OWNER = Prisma.sql`(CASE WHEN l."status" NOT IN (${statusList(PRE_QUAL)})
  AND EXISTS (SELECT 1 FROM "LeadTimeline" q WHERE q."leadId" = l."id" AND q."action" = 'LEAD_QUALIFIED')
  THEN l."assignedToId" END)`;

/** Outcome of the latest call that has one. */
const LAST_CALL = Prisma.sql`(SELECT t."outcome" FROM "LeadTimeline" t
  WHERE t."leadId" = l."id" AND t."activityType" = 'CALL' AND t."outcome" IS NOT NULL
  ORDER BY t."occurredAt" DESC, t."createdAt" DESC, t."id" DESC LIMIT 1)`;

/** Day difference (IST) between the next pending follow-up and today; NULL without one. */
const FOLLOWUP_DAYS = Prisma.sql`(
  ((SELECT min(f."followupDate") FROM "LeadFollowup" f WHERE f."leadId" = l."id" AND f."status" = 'PENDING')
     AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::date
  - (now() AT TIME ZONE ${TZ})::date)`;

type Dim =
  | 'status'
  | 'assignment'
  | 'presales'
  | 'sales'
  | 'source'
  | 'country'
  | 'state'
  | 'city'
  | 'followup'
  | 'lastCall';

function phoneSql(digits: string): Prisma.Sql {
  const cols = [Prisma.sql`l."phone"`, Prisma.sql`l."alternatePhone"`];
  const parts = cols.map((c) => {
    const d = Prisma.sql`regexp_replace(COALESCE(${c}, ''), '[^0-9]', '', 'g')`;
    return digits.length >= 10
      ? Prisma.sql`(length(${d}) >= 10 AND right(${d}, 10) = ${digits.slice(-10)})`
      : Prisma.sql`(${d} LIKE ${'%' + digits + '%'})`;
  });
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
}

function textSql(q: string): Prisma.Sql {
  const pat = `%${likeEscape(q)}%`;
  return Prisma.sql`(
    l."customerName" ILIKE ${pat} OR l."companyName" ILIKE ${pat} OR l."email" ILIKE ${pat}
    OR l."city" ILIKE ${pat} OR l."state" ILIKE ${pat} OR l."leadCode" ILIKE ${pat}
    OR EXISTS (SELECT 1 FROM "User" u WHERE u."id" = l."assignedToId" AND u."fullName" ILIKE ${pat}))`;
}

export function searchCondition(q: string): Prisma.Sql {
  const digits = q.replace(DIGITS_RE, '');
  if (PHONE_LIKE.test(q) && digits.length >= 4) return phoneSql(digits);
  return digits.length >= 4
    ? Prisma.sql`(${textSql(q)} OR ${phoneSql(digits)})`
    : textSql(q);
}

function conditions(
  query: SearchLeadsQueryDto,
  scope: RecordScope,
  except?: Dim,
): Prisma.Sql[] {
  const c: Prisma.Sql[] = [leadVisibleSql(scope, 'l')];
  if (!query.includeInactive) c.push(Prisma.sql`l."isActive" = TRUE`);
  if (query.q) c.push(searchCondition(query.q));
  if (query.assignedToId)
    c.push(Prisma.sql`l."assignedToId" = ${query.assignedToId}`);
  if (query.createdFrom)
    c.push(
      Prisma.sql`l."createdAt" >= ((${query.createdFrom}::date)::timestamp AT TIME ZONE ${TZ} AT TIME ZONE 'UTC')`,
    );
  if (query.createdTo)
    c.push(
      Prisma.sql`l."createdAt" < (((${query.createdTo}::date + 1))::timestamp AT TIME ZONE ${TZ} AT TIME ZONE 'UTC')`,
    );
  if (except !== 'status' && query.status?.length)
    c.push(Prisma.sql`l."status" IN (${statusList(query.status)})`);
  if (except !== 'assignment' && query.assignment)
    c.push(
      query.assignment === 'assigned'
        ? Prisma.sql`l."assignedToId" IS NOT NULL`
        : Prisma.sql`l."assignedToId" IS NULL`,
    );
  if (except !== 'presales' && query.presalesUserId?.length)
    c.push(
      Prisma.sql`l."id" IN (SELECT p."leadId" FROM (${PRESALES_PAIRS}) p WHERE p."userId" IN (${sqlList(query.presalesUserId)}))`,
    );
  if (except !== 'sales' && query.salesUserId?.length)
    c.push(Prisma.sql`${SALES_OWNER} IN (${sqlList(query.salesUserId)})`);
  if (except !== 'source' && query.source?.length)
    c.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "LeadSource" s WHERE s."id" = l."sourceId" AND s."name" IN (${sqlList(query.source)}))`,
    );
  if (except !== 'country' && query.country?.length) {
    const codes = query.country.filter((x) => x !== NOT_SET);
    const parts: Prisma.Sql[] = [];
    if (codes.length)
      parts.push(Prisma.sql`l."country" IN (${sqlList(codes)})`);
    if (query.country.includes(NOT_SET))
      parts.push(Prisma.sql`l."country" IS NULL`);
    c.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`);
  }
  if (except !== 'state' && query.state?.length)
    c.push(Prisma.sql`l."state" IN (${sqlList(query.state)})`);
  if (except !== 'city' && query.city?.length)
    c.push(Prisma.sql`l."city" IN (${sqlList(query.city)})`);
  if (except !== 'followup' && query.followup?.length) {
    const parts = query.followup.map((u) =>
      u === 'None'
        ? Prisma.sql`${FOLLOWUP_DAYS} IS NULL`
        : u === 'Overdue'
          ? Prisma.sql`${FOLLOWUP_DAYS} < 0`
          : u === 'Due Today'
            ? Prisma.sql`${FOLLOWUP_DAYS} = 0`
            : u === 'Tomorrow'
              ? Prisma.sql`${FOLLOWUP_DAYS} = 1`
              : Prisma.sql`${FOLLOWUP_DAYS} > 1`,
    );
    c.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`);
  }
  if (except !== 'lastCall' && query.lastCall?.length) {
    const parts = query.lastCall.map((v) =>
      v === 'NONE'
        ? Prisma.sql`${LAST_CALL} IS NULL`
        : Prisma.sql`${LAST_CALL} = ${v === 'CNC' ? 'NOT_CONNECTED' : 'CONNECTED'}`,
    );
    c.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`);
  }
  return c;
}

const where = (c: Prisma.Sql[]) => Prisma.sql`WHERE ${Prisma.join(c, ' AND ')}`;

type Count = { value: string | null; count: number };
type Extra = {
  id: string;
  salesOwnerId: string | null;
  lastCall: string | null;
};
type Pair = { leadId: string; userId: string };
type Db = Pick<PrismaClient, '$queryRaw' | 'lead' | 'user'>;

async function facet(
  db: Db,
  query: SearchLeadsQueryDto,
  scope: RecordScope,
  dim: Dim,
  expr: Prisma.Sql,
): Promise<Count[]> {
  const rows = await db.$queryRaw<
    Array<{ value: string | null; count: bigint }>
  >`
    SELECT ${expr} AS "value", count(*) AS "count" FROM "Lead" l ${where(conditions(query, scope, dim))}
    GROUP BY 1 ORDER BY 2 DESC, 1 ASC`;
  return rows.map((r) => ({ value: r.value, count: Number(r.count) }));
}

export const LEAD_SEARCH_DEFAULT_PAGE_SIZE = 25;

export async function searchLeads(
  db: Db,
  query: SearchLeadsQueryDto,
  scope: RecordScope,
) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? LEAD_SEARCH_DEFAULT_PAGE_SIZE;
  const dir = Prisma.raw(query.dir === 'asc' ? 'ASC' : 'DESC');
  const sortCol =
    query.sort === 'customerName'
      ? Prisma.sql`lower(l."customerName")`
      : query.sort === 'createdAt'
        ? Prisma.sql`l."createdAt"`
        : Prisma.sql`l."updatedAt"`;
  const all = conditions(query, scope);

  const [ids, [{ total }]] = await Promise.all([
    db.$queryRaw<Array<{ id: string }>>`
      SELECT l."id" FROM "Lead" l ${where(all)}
      ORDER BY ${sortCol} ${dir}, l."id" ${dir}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    db.$queryRaw<
      Array<{ total: bigint }>
    >`SELECT count(*) AS "total" FROM "Lead" l ${where(all)}`,
  ]);
  const pageIds = ids.map((r) => r.id);

  const [rows, extras, presalesPairs] = await Promise.all([
    db.lead.findMany({
      where: { id: { in: pageIds } },
      include: {
        source: true,
        assignedTo: { select: LEAD_ACTOR_SELECT },
        followups: true,
        opportunities: true,
      },
    }),
    pageIds.length
      ? db.$queryRaw<Extra[]>`
          SELECT l."id", ${SALES_OWNER} AS "salesOwnerId", ${LAST_CALL} AS "lastCall"
          FROM "Lead" l WHERE l."id" IN (${sqlList(pageIds)})`
      : Promise.resolve([] as Extra[]),
    pageIds.length
      ? db.$queryRaw<Pair[]>`
          SELECT DISTINCT p."leadId", p."userId" FROM (${PRESALES_PAIRS}) p WHERE p."leadId" IN (${sqlList(pageIds)})`
      : Promise.resolve([] as Pair[]),
  ]);

  const [
    status,
    assignment,
    presales,
    sales,
    source,
    country,
    state,
    city,
    followup,
    lastCall,
  ] = await Promise.all([
    facet(db, query, scope, 'status', Prisma.sql`l."status"::text`),
    facet(
      db,
      query,
      scope,
      'assignment',
      Prisma.sql`(CASE WHEN l."assignedToId" IS NULL THEN 'unassigned' ELSE 'assigned' END)`,
    ),
    db.$queryRaw<Array<{ value: string; count: bigint }>>`
      SELECT p."userId" AS "value", count(DISTINCT p."leadId") AS "count" FROM (${PRESALES_PAIRS}) p
      WHERE p."leadId" IN (SELECT l."id" FROM "Lead" l ${where(conditions(query, scope, 'presales'))})
      GROUP BY 1 ORDER BY 2 DESC`.then((r) =>
      r.map((x) => ({ value: x.value, count: Number(x.count) })),
    ),
    facet(db, query, scope, 'sales', SALES_OWNER),
    facet(
      db,
      query,
      scope,
      'source',
      Prisma.sql`(SELECT s."name" FROM "LeadSource" s WHERE s."id" = l."sourceId")`,
    ),
    facet(
      db,
      query,
      scope,
      'country',
      Prisma.sql`COALESCE(l."country", ${NOT_SET})`,
    ),
    facet(db, query, scope, 'state', Prisma.sql`l."state"`),
    facet(db, query, scope, 'city', Prisma.sql`l."city"`),
    facet(
      db,
      query,
      scope,
      'followup',
      Prisma.sql`(CASE WHEN ${FOLLOWUP_DAYS} IS NULL THEN 'None' WHEN ${FOLLOWUP_DAYS} < 0 THEN 'Overdue' WHEN ${FOLLOWUP_DAYS} = 0 THEN 'Due Today' WHEN ${FOLLOWUP_DAYS} = 1 THEN 'Tomorrow' ELSE 'Scheduled' END)`,
    ),
    facet(
      db,
      query,
      scope,
      'lastCall',
      Prisma.sql`(CASE ${LAST_CALL} WHEN 'NOT_CONNECTED' THEN 'CNC' WHEN 'CONNECTED' THEN 'CONNECTED' ELSE 'NONE' END)`,
    ),
  ]);

  // Names of the people the page and the facets mention (only people involved in leads
  // the caller may see).
  const personIds = [
    ...new Set([
      ...presalesPairs.map((p) => p.userId),
      ...extras.map((e) => e.salesOwnerId).filter((x): x is string => !!x),
      ...presales.map((p) => p.value),
      ...sales.map((s) => s.value).filter((x): x is string => !!x),
    ]),
  ];
  const found = await db.user.findMany({
    where: { id: { in: personIds } },
    select: LEAD_ACTOR_SELECT,
  });
  const people = new Map(found.map((u) => [u.id, u] as const));
  const person = (id: string | null | undefined) =>
    id ? (people.get(id) ?? { id, fullName: null }) : null;

  const byId = new Map(rows.map((r) => [r.id, r]));
  const extra = new Map(extras.map((e) => [e.id, e]));
  const items = pageIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({
      ...r,
      presales: presalesPairs
        .filter((p) => p.leadId === r.id)
        .map((p) => person(p.userId)!),
      salesOwner: person(extra.get(r.id)?.salesOwnerId),
      lastCallOutcome: extra.get(r.id)?.lastCall ?? null,
    }));

  return {
    items,
    total: Number(total),
    page,
    pageSize,
    facets: {
      status,
      assignment,
      presales: presales.map((p) => ({ ...p, person: person(p.value) })),
      sales: sales
        .filter((s) => s.value)
        .map((s) => ({ ...s, person: person(s.value) })),
      source,
      country,
      state: state.filter((s) => s.value),
      city: city.filter((s) => s.value),
      followup,
      lastCall,
    },
  };
}

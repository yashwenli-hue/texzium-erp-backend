import { Prisma, PrismaClient } from '@prisma/client';

import { findCustomerMatches } from '../customer-master/customer-lifecycle';
import {
  RecordScope,
  customerWhere,
  leadVisibleSql,
} from '../record-scope/record-scope';

// Likely duplicates of a lead: the same enquiry entered again (often from another
// source), and an existing customer it may belong to. Nothing is merged, moved or
// deleted here; the screens show the matches and the existing tools resolve them
// (deactivate the duplicate, or delete it as DUPLICATE naming the survivor).
//
//   EXACT     the same phone number (last 10 digits, phone or alternate phone, either
//             way round) or the same email
//   POSSIBLE  the same name and company, or the same company in the same city
//
// Leads have no product field, so "the same product" cannot be compared (reported as
// productComparison: "unavailable"). Matches the caller may not see are counted with
// their strength only: no name, source, time or id.

export type LeadProbe = {
  phone?: string | null;
  alternatePhone?: string | null;
  email?: string | null;
  customerName?: string | null;
  companyName?: string | null;
  city?: string | null;
  createdAt?: Date | null;
  excludeLeadId?: string | null;
};

const last10 = (p?: string | null) => {
  const d = (p ?? '').replace(/\D+/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
};
const norm = (s?: string | null) => {
  const t = (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return t === '' ? null : t;
};

type Row = {
  id: string;
  customerName: string;
  companyName: string | null;
  status: string;
  isActive: boolean;
  createdAt: Date;
  sourceName: string | null;
  phoneMatch: boolean;
  emailMatch: boolean;
  nameMatch: boolean;
  placeMatch: boolean;
  visible: boolean;
};

const D = (col: Prisma.Sql) =>
  Prisma.sql`right(regexp_replace(COALESCE(${col}, ''), '[^0-9]', '', 'g'), 10)`;

export async function findLeadDuplicates(
  db: Pick<PrismaClient, '$queryRaw' | 'customer'>,
  probe: LeadProbe,
  scope: RecordScope,
) {
  const phones = [
    ...new Set(
      [last10(probe.phone), last10(probe.alternatePhone)].filter(
        (x): x is string => !!x,
      ),
    ),
  ];
  const email = norm(probe.email);
  const name = norm(probe.customerName);
  const company = norm(probe.companyName);
  const city = norm(probe.city);
  const exclude = probe.excludeLeadId ?? null;

  const phoneSql = phones.length
    ? Prisma.sql`((length(regexp_replace(COALESCE(l."phone", ''), '[^0-9]', '', 'g')) >= 10 AND ${D(Prisma.sql`l."phone"`)} IN (${Prisma.join(phones)}))
        OR (length(regexp_replace(COALESCE(l."alternatePhone", ''), '[^0-9]', '', 'g')) >= 10 AND ${D(Prisma.sql`l."alternatePhone"`)} IN (${Prisma.join(phones)})))`
    : Prisma.sql`FALSE`;
  const emailSql = email
    ? Prisma.sql`(lower(btrim(l."email")) = ${email})`
    : Prisma.sql`FALSE`;
  const nameSql =
    name && company
      ? Prisma.sql`(lower(regexp_replace(btrim(l."customerName"), '[[:space:]]+', ' ', 'g')) = ${name}
          AND lower(regexp_replace(btrim(COALESCE(l."companyName", '')), '[[:space:]]+', ' ', 'g')) = ${company})`
      : Prisma.sql`FALSE`;
  const placeSql =
    company && city
      ? Prisma.sql`(lower(regexp_replace(btrim(COALESCE(l."companyName", '')), '[[:space:]]+', ' ', 'g')) = ${company}
          AND lower(btrim(COALESCE(l."city", ''))) = ${city})`
      : Prisma.sql`FALSE`;

  const rows = await db.$queryRaw<Row[]>`
    SELECT * FROM (
      SELECT l."id", l."customerName", l."companyName", l."status"::text AS "status", l."isActive", l."createdAt",
             (SELECT s."name" FROM "LeadSource" s WHERE s."id" = l."sourceId") AS "sourceName",
             ${phoneSql} AS "phoneMatch", ${emailSql} AS "emailMatch", ${nameSql} AS "nameMatch", ${placeSql} AS "placeMatch",
             ${leadVisibleSql(scope, 'l')} AS "visible"
      FROM "Lead" l
      WHERE (${exclude}::text IS NULL OR l."id" <> ${exclude}::text)
    ) m
    WHERE m."phoneMatch" OR m."emailMatch" OR m."nameMatch" OR m."placeMatch"
    ORDER BY (m."phoneMatch" OR m."emailMatch") DESC, m."createdAt" ASC
    LIMIT 50`;

  const at = probe.createdAt ?? null;
  const leads = rows.map((r) => {
    const strength = r.phoneMatch || r.emailMatch ? 'EXACT' : 'POSSIBLE';
    const reasons = [
      ...(r.phoneMatch ? ['PHONE'] : []),
      ...(r.emailMatch ? ['EMAIL'] : []),
      ...(r.nameMatch ? ['NAME_AND_COMPANY'] : []),
      ...(r.placeMatch ? ['COMPANY_AND_CITY'] : []),
    ];
    if (!r.visible) return { hidden: true as const, strength, reasons };
    return {
      id: r.id,
      customerName: r.customerName,
      companyName: r.companyName,
      status: r.status,
      isActive: r.isActive,
      createdAt: r.createdAt,
      sourceName: r.sourceName,
      // Which came first, relative to the lead being looked at (when there is one).
      relation: at ? (r.createdAt < at ? 'EARLIER' : 'LATER') : null,
      strength,
      reasons,
    };
  });

  // An existing customer the enquiry may belong to (phone, email or company name).
  const customerMatches = await findCustomerMatches(db, {
    name: probe.companyName?.trim() || null,
    pan: null,
    phone: probe.phone ?? null,
    email: email,
  });
  const visibleCustomers = scope.all
    ? null
    : new Set(
        (
          await db.customer.findMany({
            where: {
              AND: [
                { id: { in: customerMatches.map((m) => m.id) } },
                customerWhere(scope) ?? {},
              ],
            },
            select: { id: true },
          })
        ).map((c) => c.id),
      );
  const customers = customerMatches.map((m) => {
    const reasons = [
      ...(m.nameMatch ? ['COMPANY_NAME'] : []),
      ...(m.phoneMatch ? ['PHONE'] : []),
      ...(m.emailMatch ? ['EMAIL'] : []),
    ];
    return !visibleCustomers || visibleCustomers.has(m.id)
      ? {
          id: m.id,
          customerCode: m.customerCode,
          customerName: m.customerName,
          isActive: m.isActive,
          reasons,
        }
      : { hidden: true as const, reasons };
  });

  return {
    leads,
    customers,
    exact: leads.filter((l) => l.strength === 'EXACT').length,
    possible: leads.filter((l) => l.strength === 'POSSIBLE').length,
    productComparison: 'unavailable' as const,
  };
}

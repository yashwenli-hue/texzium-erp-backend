import { Prisma, PrismaClient } from '@prisma/client';

import {
  findCustomerMatches,
  matchReasons,
  matchStrength,
} from '../customer-master/customer-lifecycle';
import {
  customerSalesperson,
  customerSalespeople,
  MappedSalesperson,
  SalespersonResolution,
} from '../customer-master/customer-relationship';
import {
  RecordScope,
  customerWhere,
  leadVisibleSql,
} from '../record-scope/record-scope';

// Returning enquiries: who has asked before, and what that means for this enquiry.
// Nothing is merged, moved, blocked or deleted here - the screens show the context and
// people decide (record it as a new enquiry, or resolve an accidental duplicate with the
// existing tools: deactivate it, or delete it as DUPLICATE naming the survivor).
//
// Five different things, never treated as the same:
//   returning person     the same person (or company) has enquired before - `person`
//   repeat enquiry       a NEW enquiry from them: about another product, or after the
//                        earlier one closed (won, lost, rejected) or was deactivated
//   potential duplicate  probably the same enquiry entered twice: the same person, the
//                        earlier one still open, and the same product (or a product not
//                        recorded on one of them)
//   existing customer    a customer record that matches the enquiry's details (MATCH)
//   linked customer      the customer this lead is explicitly tied to through one of its
//                        opportunities (LINKED)
//
// How sure the person match is (a phone number may be shared or passed on, so it is not
// enough on its own):
//   EXACT     phone or email AND the same name; or phone AND email
//   STRONG    the same email; or the same phone and the same company
//   POSSIBLE  the same phone only (another name: maybe another person); the same name and
//             company; or the same company in the same city
// Only EXACT and STRONG matches are called repeat enquiries or potential duplicates;
// a POSSIBLE match is shown as such for a person to judge.
//
// What the caller may see: a lead outside their scope is shown without name, contact,
// source or dates - only how it matches, what kind it is and who handles it (for routing).
// A customer is shown in full only to someone who may see it AND holds customers.view;
// otherwise only that it exists, how it matches, and the salesperson who looks after it.

export type LeadProbe = {
  phone?: string | null;
  alternatePhone?: string | null;
  email?: string | null;
  customerName?: string | null;
  companyName?: string | null;
  city?: string | null;
  gstin?: string | null;
  inventoryItemId?: string | null;
  createdAt?: Date | null;
  excludeLeadId?: string | null;
};

export type ReturningOptions = { canViewCustomers: boolean };

export type EnquiryStrength = 'EXACT' | 'STRONG' | 'POSSIBLE';
export type EnquiryKind =
  | 'POTENTIAL_DUPLICATE'
  | 'REPEAT_ENQUIRY'
  | 'POSSIBLE_MATCH';

const CLOSED_STATUSES = new Set(['WON', 'LOST', 'REJECTED']);

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
  inventoryItemId: string | null;
  productName: string | null;
  productSku: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  phoneMatch: boolean;
  emailMatch: boolean;
  sameName: boolean;
  sameCompany: boolean;
  nameMatch: boolean;
  placeMatch: boolean;
  visible: boolean;
};

export function enquiryStrength(m: {
  phoneMatch: boolean;
  emailMatch: boolean;
  sameName: boolean;
  sameCompany: boolean;
}): EnquiryStrength {
  if (
    ((m.phoneMatch || m.emailMatch) && m.sameName) ||
    (m.phoneMatch && m.emailMatch)
  )
    return 'EXACT';
  if (m.emailMatch || (m.phoneMatch && m.sameCompany)) return 'STRONG';
  return 'POSSIBLE';
}

export function enquiryKind(
  strength: EnquiryStrength,
  other: { status: string; isActive: boolean; inventoryItemId: string | null },
  probeItemId: string | null,
): { kind: EnquiryKind; sameProduct: boolean | null } {
  const sameProduct =
    probeItemId && other.inventoryItemId
      ? probeItemId === other.inventoryItemId
      : null;
  if (strength === 'POSSIBLE') return { kind: 'POSSIBLE_MATCH', sameProduct };
  const open = other.isActive && !CLOSED_STATUSES.has(other.status);
  return {
    kind:
      open && sameProduct !== false ? 'POTENTIAL_DUPLICATE' : 'REPEAT_ENQUIRY',
    sameProduct,
  };
}

const D = (col: Prisma.Sql) =>
  Prisma.sql`right(regexp_replace(COALESCE(${col}, ''), '[^0-9]', '', 'g'), 10)`;
const N = (col: Prisma.Sql) =>
  Prisma.sql`lower(regexp_replace(btrim(COALESCE(${col}, '')), '[[:space:]]+', ' ', 'g'))`;

type Db = Pick<PrismaClient, '$queryRaw' | 'customer' | 'opportunity'>;

export async function findLeadDuplicates(
  db: Db,
  probe: LeadProbe,
  scope: RecordScope,
  options: ReturningOptions = { canViewCustomers: true },
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
  const probeItem = probe.inventoryItemId ?? null;

  const phoneSql = phones.length
    ? Prisma.sql`((length(regexp_replace(COALESCE(l."phone", ''), '[^0-9]', '', 'g')) >= 10 AND ${D(Prisma.sql`l."phone"`)} IN (${Prisma.join(phones)}))
        OR (length(regexp_replace(COALESCE(l."alternatePhone", ''), '[^0-9]', '', 'g')) >= 10 AND ${D(Prisma.sql`l."alternatePhone"`)} IN (${Prisma.join(phones)})))`
    : Prisma.sql`FALSE`;
  const emailSql = email
    ? Prisma.sql`(lower(btrim(l."email")) = ${email})`
    : Prisma.sql`FALSE`;
  const sameNameSql = name
    ? Prisma.sql`(${N(Prisma.sql`l."customerName"`)} = ${name})`
    : Prisma.sql`FALSE`;
  const sameCompanySql = company
    ? Prisma.sql`(${N(Prisma.sql`l."companyName"`)} = ${company})`
    : Prisma.sql`FALSE`;
  const nameSql =
    name && company
      ? Prisma.sql`(${sameNameSql} AND ${sameCompanySql})`
      : Prisma.sql`FALSE`;
  const placeSql =
    company && city
      ? Prisma.sql`(${sameCompanySql} AND lower(btrim(COALESCE(l."city", ''))) = ${city})`
      : Prisma.sql`FALSE`;

  const rows = await db.$queryRaw<Row[]>`
    SELECT * FROM (
      SELECT l."id", l."customerName", l."companyName", l."status"::text AS "status", l."isActive", l."createdAt",
             (SELECT s."name" FROM "LeadSource" s WHERE s."id" = l."sourceId") AS "sourceName",
             l."inventoryItemId",
             (SELECT i."productName" FROM "InventoryItem" i WHERE i."id" = l."inventoryItemId") AS "productName",
             (SELECT i."sku" FROM "InventoryItem" i WHERE i."id" = l."inventoryItemId") AS "productSku",
             l."assignedToId",
             (SELECT u."fullName" FROM "User" u WHERE u."id" = l."assignedToId") AS "assignedToName",
             ${phoneSql} AS "phoneMatch", ${emailSql} AS "emailMatch",
             ${sameNameSql} AS "sameName", ${sameCompanySql} AS "sameCompany",
             ${nameSql} AS "nameMatch", ${placeSql} AS "placeMatch",
             ${leadVisibleSql(scope, 'l')} AS "visible"
      FROM "Lead" l
      WHERE (${exclude}::text IS NULL OR l."id" <> ${exclude}::text)
    ) m
    WHERE m."phoneMatch" OR m."emailMatch" OR m."nameMatch" OR m."placeMatch"
    ORDER BY (m."phoneMatch" OR m."emailMatch") DESC, m."createdAt" ASC
    LIMIT 50`;

  // Customers the earlier enquiries are linked to (through their opportunities), and the
  // customers linked to this lead itself.
  const linkRows = await db.opportunity.findMany({
    where: {
      leadId: {
        in: [...rows.map((r) => r.id), ...(exclude ? [exclude] : [])],
      },
      customerId: { not: null },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: { leadId: true, customerId: true },
  });
  const linkedTo = new Map<string, string>();
  for (const o of linkRows)
    if (o.customerId && !linkedTo.has(o.leadId))
      linkedTo.set(o.leadId, o.customerId);
  const ownLinked = [
    ...new Set(
      linkRows
        .filter((o) => o.leadId === exclude && o.customerId)
        .map((o) => o.customerId as string),
    ),
  ];

  const customerMatches = await findCustomerMatches(db, {
    name: probe.companyName?.trim() || null,
    pan: null,
    phone: probe.phone ?? null,
    email,
    gstin: probe.gstin ?? null,
  });

  const allCustomerIds = [
    ...new Set([
      ...customerMatches.map((m) => m.id),
      ...ownLinked,
      ...linkedTo.values(),
    ]),
  ];
  const visibleCustomers = new Set(
    !options.canViewCustomers
      ? []
      : scope.all
        ? allCustomerIds
        : (
            await db.customer.findMany({
              where: {
                AND: [
                  { id: { in: allCustomerIds } },
                  customerWhere(scope) ?? {},
                ],
              },
              select: { id: true },
            })
          ).map((c) => c.id),
  );
  const mapped = await customerSalespeople(db, allCustomerIds);
  const resolved = await customerSalesperson(db, allCustomerIds);
  const named = new Map(
    (
      await db.customer.findMany({
        where: { id: { in: [...visibleCustomers] } },
        select: {
          id: true,
          customerCode: true,
          customerName: true,
          isActive: true,
        },
      })
    ).map((c) => [c.id, c] as const),
  );
  const customerRef = (id: string) => {
    const mappedTo: MappedSalesperson[] = mapped.get(id) ?? [];
    const salesperson: SalespersonResolution = resolved.get(id) ?? {
      status: 'NOT_CLEAR',
      reason: 'NONE',
    };
    const c = named.get(id);
    return c
      ? {
          id: c.id,
          customerCode: c.customerCode,
          customerName: c.customerName,
          isActive: c.isActive,
          mappedTo,
          salesperson,
        }
      : { hidden: true as const, mappedTo, salesperson };
  };

  const at = probe.createdAt ?? null;
  const leads = rows.map((r) => {
    const strength = enquiryStrength(r);
    const { kind, sameProduct } = enquiryKind(strength, r, probeItem);
    const reasons = [
      ...(r.phoneMatch ? ['PHONE'] : []),
      ...(r.emailMatch ? ['EMAIL'] : []),
      ...((r.phoneMatch || r.emailMatch) && r.sameName ? ['NAME'] : []),
      ...(r.nameMatch ? ['NAME_AND_COMPANY'] : []),
      ...(r.placeMatch ? ['COMPANY_AND_CITY'] : []),
    ];
    // A phone or email shared by someone with another name: maybe another person.
    const differentName =
      !!name && (r.phoneMatch || r.emailMatch) && !r.sameName;
    const relation = at ? (r.createdAt < at ? 'EARLIER' : 'LATER') : null;
    const handledBy = r.assignedToId
      ? { id: r.assignedToId, fullName: r.assignedToName }
      : null;
    if (!r.visible)
      return {
        hidden: true as const,
        strength,
        reasons,
        differentName,
        kind,
        relation,
        handledBy,
      };
    const customerId = linkedTo.get(r.id);
    return {
      id: r.id,
      customerName: r.customerName,
      companyName: r.companyName,
      status: r.status,
      isActive: r.isActive,
      createdAt: r.createdAt,
      sourceName: r.sourceName,
      inventoryItem: r.inventoryItemId
        ? {
            id: r.inventoryItemId,
            productName: r.productName,
            sku: r.productSku,
          }
        : null,
      assignedTo: handledBy,
      customer: customerId ? customerRef(customerId) : null,
      relation,
      strength,
      reasons,
      differentName,
      kind,
      sameProduct,
    };
  });

  const customers = [
    ...ownLinked.map((id) => ({
      ...customerRef(id),
      link: 'LINKED' as const,
      strength: null,
      reasons: [] as string[],
    })),
    ...customerMatches
      .filter((m) => !ownLinked.includes(m.id))
      .map((m) => ({
        ...customerRef(m.id),
        link: 'MATCH' as const,
        strength: matchStrength(m),
        reasons: matchReasons(m) as string[],
      })),
  ];

  const sure = leads.filter((l) => l.strength !== 'POSSIBLE');
  return {
    person: {
      returning:
        sure.length > 0 ||
        customers.some(
          (c) =>
            c.link === 'LINKED' || (c.strength && c.strength !== 'POSSIBLE'),
        ),
      previousEnquiries: sure.filter((l) => l.relation !== 'LATER').length,
    },
    leads,
    customers,
    summary: {
      potentialDuplicates: leads.filter((l) => l.kind === 'POTENTIAL_DUPLICATE')
        .length,
      repeatEnquiries: leads.filter((l) => l.kind === 'REPEAT_ENQUIRY').length,
      possibleMatches: leads.filter((l) => l.kind === 'POSSIBLE_MATCH').length,
      linkedCustomers: customers.filter((c) => c.link === 'LINKED').length,
      matchingCustomers: customers.filter((c) => c.link === 'MATCH').length,
    },
    // Whether products could be compared: only when this enquiry has one recorded.
    productComparison: probeItem
      ? ('available' as const)
      : ('unavailable' as const),
  };
}

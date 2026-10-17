import { PrismaClient } from '@prisma/client';

// Who looks after a customer, for routing an enquiry to the right salesperson (D3,
// confirmed 2026-10-17). There is no customer-owner field; the relationship is derived
// from data that already exists: the person each lead behind one of the customer's
// opportunities is assigned to (after qualification that is the sales owner), the most
// recent opportunity first, active users only.
//
// Limited disclosure: only the salesperson's id and name are given, also to someone who
// may not open the customer. Knowing who looks after a customer never grants access to
// it - the customer's own details stay behind the record scope.

export type MappedSalesperson = { id: string; fullName: string };

// Who CREATED a customer is a different fact from who looks after it: the actor of its
// CUSTOMER_CREATED event, when one was recorded (customers created before actors were
// recorded, or by the system, have none). It is never used as the owner, and it is only
// given to someone who may see the customer itself.
export async function customerCreators(
  db: Pick<PrismaClient, 'customerEvent'>,
  customerIds: readonly string[],
): Promise<Map<string, MappedSalesperson>> {
  const ids = [...new Set(customerIds)].filter((x) => !!x);
  const out = new Map<string, MappedSalesperson>();
  if (!ids.length) return out;
  const rows = await db.customerEvent.findMany({
    where: {
      customerId: { in: ids },
      action: 'CUSTOMER_CREATED',
      actorId: { not: null },
    },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: {
      customerId: true,
      actor: { select: { id: true, fullName: true } },
    },
  });
  for (const r of rows)
    if (r.actor && !out.has(r.customerId)) out.set(r.customerId, r.actor);
  return out;
}

// The ONE salesperson a customer can be routed to, or why there is none. Reliable only
// when every lead behind the customer's opportunities that has an assignee has the SAME
// assignee and that person is active. Otherwise it is not clear - nobody is guessed:
//   NONE      no opportunity, or none of their leads is assigned
//   INACTIVE  the one assignee is no longer active
//   MULTIPLE  different people are assigned across its deals (history or shared account)
export type SalespersonResolution =
  | { status: 'ASSIGNED'; id: string; fullName: string }
  | { status: 'NOT_CLEAR'; reason: 'NONE' | 'INACTIVE' | 'MULTIPLE' };

export async function customerSalesperson(
  db: Pick<PrismaClient, 'opportunity'>,
  customerIds: readonly string[],
): Promise<Map<string, SalespersonResolution>> {
  const ids = [...new Set(customerIds)].filter((x) => !!x);
  const out = new Map<string, SalespersonResolution>();
  for (const id of ids) out.set(id, { status: 'NOT_CLEAR', reason: 'NONE' });
  if (!ids.length) return out;
  const rows = await db.opportunity.findMany({
    where: { customerId: { in: ids }, lead: { assignedToId: { not: null } } },
    select: {
      customerId: true,
      lead: {
        select: {
          assignedTo: { select: { id: true, fullName: true, status: true } },
        },
      },
    },
  });
  const people = new Map<
    string,
    Map<string, { fullName: string; status: string }>
  >();
  for (const r of rows) {
    const p = r.lead.assignedTo;
    if (!r.customerId || !p) continue;
    const m = people.get(r.customerId) ?? new Map();
    m.set(p.id, { fullName: p.fullName, status: p.status });
    people.set(r.customerId, m);
  }
  for (const [customerId, m] of people) {
    if (m.size > 1) {
      out.set(customerId, { status: 'NOT_CLEAR', reason: 'MULTIPLE' });
      continue;
    }
    const [[id, p]] = [...m.entries()];
    out.set(
      customerId,
      p.status === 'ACTIVE'
        ? { status: 'ASSIGNED', id, fullName: p.fullName }
        : { status: 'NOT_CLEAR', reason: 'INACTIVE' },
    );
  }
  return out;
}

type Db = Pick<PrismaClient, 'opportunity'>;

export async function customerSalespeople(
  db: Db,
  customerIds: readonly string[],
): Promise<Map<string, MappedSalesperson[]>> {
  const ids = [...new Set(customerIds)].filter((x) => !!x);
  const out = new Map<string, MappedSalesperson[]>();
  if (!ids.length) return out;
  const rows = await db.opportunity.findMany({
    where: {
      customerId: { in: ids },
      lead: { assignedTo: { status: 'ACTIVE' } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: {
      customerId: true,
      lead: {
        select: { assignedTo: { select: { id: true, fullName: true } } },
      },
    },
  });
  for (const r of rows) {
    const person = r.lead.assignedTo;
    if (!r.customerId || !person) continue;
    const list = out.get(r.customerId) ?? [];
    if (!list.some((p) => p.id === person.id)) list.push(person);
    out.set(r.customerId, list);
  }
  return out;
}

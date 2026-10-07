import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

// The Customer lifecycle:
//
//   ACTIVE <-> INACTIVE
//
// "Customer"."isActive" is the source of truth. An inactive customer is kept
// with everything that refers to it; nothing is deleted. Deactivating needs a
// reason, reactivating does not. An inactive customer cannot be edited:
// reactivate it first.
export const CUSTOMER_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

export const CUSTOMER_EVENT_ACTION = {
  CUSTOMER_CREATED: 'CUSTOMER_CREATED',
  CUSTOMER_UPDATED: 'CUSTOMER_UPDATED',
  CUSTOMER_DEACTIVATED: 'CUSTOMER_DEACTIVATED',
  CUSTOMER_REACTIVATED: 'CUSTOMER_REACTIVATED',
  GST_ADDED: 'GST_ADDED',
  GST_UPDATED: 'GST_UPDATED',
  GST_DEACTIVATED: 'GST_DEACTIVATED',
  GST_REACTIVATED: 'GST_REACTIVATED',
  GST_DEFAULT_CHANGED: 'GST_DEFAULT_CHANGED',
} as const;

export const CUSTOMER_NOT_FOUND_MESSAGE = 'Customer not found.';

// Only these User fields ever leave the API as an actor.
export const CUSTOMER_ACTOR_SELECT = {
  id: true,
  fullName: true,
} satisfies Prisma.UserSelect;

// What a customer is returned with: its GST registrations (default first) and,
// while deactivated, who deactivated it.
export const CUSTOMER_INCLUDE = {
  gstRegistrations: {
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
  },
  deactivatedBy: { select: CUSTOMER_ACTOR_SELECT },
} satisfies Prisma.CustomerInclude;

export function customerStatusOf(isActive: boolean): string {
  return isActive ? CUSTOMER_STATUS.ACTIVE : CUSTOMER_STATUS.INACTIVE;
}

type Tx = Prisma.TransactionClient;

// ----------------------------------------------------------------------
// Persistence helpers
// ----------------------------------------------------------------------

// Locks the customer row against every other writer (FOR UPDATE) and returns
// its state while holding the lock, so a lifecycle action reads the state and
// changes it as one atomic decision.
export async function lockCustomer(
  tx: Tx,
  customerId: string,
): Promise<{ isActive: boolean }> {
  const rows = await tx.$queryRaw<Array<{ isActive: boolean }>>`
    /* customer:lock */
    SELECT "isActive"
    FROM "Customer"
    WHERE "id" = ${customerId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    throw new NotFoundException(CUSTOMER_NOT_FOUND_MESSAGE);
  }

  return rows[0];
}

export async function requireCustomer(
  db: Pick<Tx, 'customer'>,
  customerId: string,
): Promise<{ id: string }> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });

  if (!customer) {
    throw new NotFoundException(CUSTOMER_NOT_FOUND_MESSAGE);
  }

  return customer;
}

// The authenticated user. The actor of every event is always the id of the
// signed-in user; a request cannot name one.
export async function requireCustomerActor(
  db: { user: Pick<Prisma.UserDelegate, 'findUnique'> },
  actorId: string | undefined,
): Promise<{ id: string }> {
  if (!actorId) {
    throw new UnauthorizedException('Authenticated user required.');
  }

  const actor = await db.user.findUnique({
    where: { id: actorId },
    select: { id: true },
  });

  if (!actor) {
    throw new UnauthorizedException('Authenticated user not found.');
  }

  return actor;
}

export function recordCustomerEvent(
  tx: Pick<Tx, 'customerEvent'>,
  event: {
    customerId: string;
    action: string;
    fromStatus?: string;
    toStatus?: string;
    remarks?: string;
    changes?: Prisma.InputJsonObject;
    gstRegistrationId?: string;
    actorId: string;
    occurredAt: Date;
  },
) {
  return tx.customerEvent.create({
    data: {
      customerId: event.customerId,
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      remarks: event.remarks,
      changes: event.changes,
      gstRegistrationId: event.gstRegistrationId,
      actorId: event.actorId,
      occurredAt: event.occurredAt,
    },
  });
}

// The next customer code number. The sequence is atomic: two simultaneous
// creations are never given the same number.
export async function takeCustomerCodeNumber(tx: Tx): Promise<bigint> {
  const rows = await tx.$queryRaw<Array<{ n: string }>>`
    /* customer:next-code */
    SELECT nextval('customer_code_seq')::text AS "n"
  `;

  return BigInt(rows[0].n);
}

// NOTE on the SQL below: these are JavaScript template literals, where "\s"
// and "\D" lose their backslash before the database ever sees them. The
// patterns therefore use POSIX classes ('[[:space:]]+', '[^0-9]'), which
// survive. The unit spec checks the statement text for exactly this.
//
// Holds a transaction-scoped lock on a customer name until it ends, so two
// creations (or renames) to the same name run one after the other and the
// second sees the first. Names are compared the way findCustomerMatches
// compares them. The database cannot enforce name uniqueness (customers
// created elsewhere, by the vendor flow, do not go through this check), so
// this is the application's guard.
export async function lockCustomerName(tx: Tx, name: string): Promise<void> {
  await tx.$executeRaw`
    /* customer:name-lock */
    SELECT pg_advisory_xact_lock(
      hashtext('customer-name:' || lower(regexp_replace(btrim(${name}::text), '[[:space:]]+', ' ', 'g')))
    )
  `;
}

export type CustomerMatchReason = 'PAN' | 'NAME' | 'PHONE' | 'EMAIL';

export type CustomerMatch = {
  id: string;
  customerCode: string;
  customerName: string;
  isActive: boolean;
  panMatch: boolean;
  nameMatch: boolean;
  phoneMatch: boolean;
  emailMatch: boolean;
};

// Customers that look like the one described. PAN and name are blocking
// matches, phone and email only warn. Each field is compared the way
// customer-values.ts describes; a field that is null is not compared.
// `excludeId` leaves one customer out (the one being edited).
export async function findCustomerMatches(
  db: Pick<Tx, '$queryRaw'>,
  probe: {
    name: string | null;
    pan: string | null;
    phone: string | null;
    email: string | null;
    excludeId?: string | null;
  },
): Promise<CustomerMatch[]> {
  const { name, pan, phone, email } = probe;
  const excludeId = probe.excludeId ?? null;

  return db.$queryRaw<CustomerMatch[]>`
    /* customer:matches */
    SELECT * FROM (
      SELECT
        c."id",
        c."customerCode",
        c."customerName",
        c."isActive",
        (${pan}::text IS NOT NULL
          AND c."panNumber" IS NOT NULL
          AND btrim(c."panNumber") <> ''
          AND upper(btrim(c."panNumber")) = upper(btrim(${pan}::text))) AS "panMatch",
        (${name}::text IS NOT NULL
          AND lower(regexp_replace(btrim(c."customerName"), '[[:space:]]+', ' ', 'g'))
            = lower(regexp_replace(btrim(${name}::text), '[[:space:]]+', ' ', 'g'))) AS "nameMatch",
        (${phone}::text IS NOT NULL
          AND c."phone" IS NOT NULL
          AND length(regexp_replace(c."phone", '[^0-9]', '', 'g')) >= 7
          AND length(regexp_replace(${phone}::text, '[^0-9]', '', 'g')) >= 7
          AND right(regexp_replace(c."phone", '[^0-9]', '', 'g'), 10)
            = right(regexp_replace(${phone}::text, '[^0-9]', '', 'g'), 10)) AS "phoneMatch",
        (${email}::text IS NOT NULL
          AND c."email" IS NOT NULL
          AND lower(btrim(c."email")) = lower(btrim(${email}::text))) AS "emailMatch"
      FROM "Customer" c
      WHERE (${excludeId}::text IS NULL OR c."id" <> ${excludeId}::text)
    ) m
    WHERE m."panMatch" OR m."nameMatch" OR m."phoneMatch" OR m."emailMatch"
    ORDER BY m."panMatch" DESC, m."nameMatch" DESC, m."customerCode" ASC
  `;
}

export function matchReasons(match: CustomerMatch): CustomerMatchReason[] {
  const reasons: CustomerMatchReason[] = [];

  if (match.panMatch) reasons.push('PAN');
  if (match.nameMatch) reasons.push('NAME');
  if (match.phoneMatch) reasons.push('PHONE');
  if (match.emailMatch) reasons.push('EMAIL');

  return reasons;
}

// Prisma reports a unique-index violation as P2002. `fragment` is a piece of
// the index or field name, so the caller can tell the customer code apart from
// the PAN.
export function isUniqueViolation(error: unknown, fragment: string): boolean {
  const e = error as { code?: string; meta?: unknown } | null;

  return (
    !!e &&
    e.code === 'P2002' &&
    JSON.stringify(e.meta ?? {})
      .toLowerCase()
      .includes(fragment.toLowerCase())
  );
}

// ----------------------------------------------------------------------
// Conflicts
// ----------------------------------------------------------------------

export const CUSTOMER_CONFLICT_CODE = {
  DUPLICATE_PAN: 'DUPLICATE_PAN',
  DUPLICATE_NAME: 'DUPLICATE_NAME',
  CUSTOMER_INACTIVE: 'CUSTOMER_INACTIVE',
  ALREADY_INACTIVE: 'ALREADY_INACTIVE',
  ALREADY_ACTIVE: 'ALREADY_ACTIVE',
  PAN_MISMATCHES_GST: 'PAN_MISMATCHES_GST',
} as const;

type ExistingCustomer = Pick<
  CustomerMatch,
  'id' | 'customerCode' | 'customerName' | 'isActive'
>;

export function conflict(
  message: string,
  code: string,
  existing?: ExistingCustomer,
  extra?: Record<string, unknown>,
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message,
    code,
    ...extra,
    ...(existing
      ? {
          existing: {
            id: existing.id,
            customerCode: existing.customerCode,
            customerName: existing.customerName,
            isActive: existing.isActive,
          },
        }
      : {}),
  });
}

export function conflictDuplicatePan(
  existing?: ExistingCustomer,
): ConflictException {
  return conflict(
    existing
      ? `A customer with this PAN already exists: ${existing.customerName} (${existing.customerCode}). Add another site as a GST registration of that customer instead.`
      : 'A customer with this PAN already exists. Add another site as a GST registration of that customer instead.',
    CUSTOMER_CONFLICT_CODE.DUPLICATE_PAN,
    existing,
  );
}

export function conflictDuplicateName(
  existing: ExistingCustomer,
): ConflictException {
  return conflict(
    `A customer with this name already exists: ${existing.customerName} (${existing.customerCode}). Use that customer, or make the name distinct.`,
    CUSTOMER_CONFLICT_CODE.DUPLICATE_NAME,
    existing,
  );
}

export function conflictCustomerInactive(
  message = 'This customer is inactive. Reactivate it to edit it.',
): ConflictException {
  return conflict(message, CUSTOMER_CONFLICT_CODE.CUSTOMER_INACTIVE);
}

export function conflictPanMismatchesGst(): ConflictException {
  return conflict(
    "This PAN does not match the GSTIN of one or more of the customer's active GST registrations. Deactivate those registrations first, or use the PAN they carry.",
    CUSTOMER_CONFLICT_CODE.PAN_MISMATCHES_GST,
  );
}

export function conflictAlreadyInactive(): ConflictException {
  return conflict(
    'This customer is already inactive.',
    CUSTOMER_CONFLICT_CODE.ALREADY_INACTIVE,
  );
}

export function conflictAlreadyActive(): ConflictException {
  return conflict(
    'This customer is already active.',
    CUSTOMER_CONFLICT_CODE.ALREADY_ACTIVE,
  );
}

// PAN is checked before name: it is the stronger identity.
export function assertNoBlockingDuplicate(matches: CustomerMatch[]): void {
  const byPan = matches.find((m) => m.panMatch);

  if (byPan) throw conflictDuplicatePan(byPan);

  const byName = matches.find((m) => m.nameMatch);

  if (byName) throw conflictDuplicateName(byName);
}

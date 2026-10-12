import { Prisma } from '@prisma/client';

import {
  DELETION_ENTITY,
  Db,
  DeletionBlocker,
  DeletionEvaluation,
  DeletionLine,
  DeletionPolicy,
  RestoreConflict,
  RestoreEvaluation,
  versionOf,
} from '../data-governance/data-deletion';
import {
  idsOf,
  isRow,
  reviveRow,
  rowsOf,
  uniqueStrings,
} from '../data-governance/snapshot';
import {
  findCustomerMatches,
  lockCustomerName,
  recordCustomerEvent,
} from './customer-lifecycle';

// Governed deletion of a customer: for a customer that was entered by mistake, is a
// duplicate, a test or junk, and that nothing else depends on. It is the same
// architecture as the lead's (see leads/lead-deletion.policy.ts); only the rules differ.
//
// What stands in the way (financial documents are NEVER deleted, so anything that could
// tie one to this customer keeps the customer):
//
//   - a linked opportunity (Opportunity.customerId; the customer comes off a deal with the
//     existing unlink, which is possible until a quotation exists);
//   - a GST registration of the customer used by a quotation or sales order (buyerGstId has
//     no foreign key, so it is checked here; proforma invoices follow their quotation);
//   - a dispatch order that refers to the customer by id;
//   - a vendor record linked to it (either direction);
//   - a financial record that carries its name: sales invoices, customer-ledger entries and
//     dispatch orders name their customer by TEXT, with no key. The match is conservative:
//     the name, or the legal or trade name of any of its registrations, compared without
//     regard to case or repeated spaces. A customer whose name appears on one is kept.
//
// The registrations and the history events of the customer are removed with it and are in
// the tombstone (so they come back with a restore).
export const CUSTOMER_BLOCKER = {
  OPPORTUNITIES: 'CUSTOMER_HAS_OPPORTUNITIES',
  GST_IN_DOCUMENTS: 'CUSTOMER_GST_IN_DOCUMENTS',
  DISPATCH_ORDERS: 'CUSTOMER_HAS_DISPATCH_ORDERS',
  VENDOR_LINK: 'CUSTOMER_VENDOR_LINK',
  NAME_IN_FINANCIAL_RECORDS: 'CUSTOMER_NAME_IN_FINANCIAL_RECORDS',
  CONTENT_SHARED: 'CUSTOMER_HAS_CONTENT_SHARES',
} as const;

export const CUSTOMER_RESTORE_CONFLICT = {
  SNAPSHOT_INVALID: 'CUSTOMER_SNAPSHOT_INVALID',
  ID_EXISTS: 'CUSTOMER_ID_EXISTS',
  CODE_TAKEN: 'CUSTOMER_CODE_TAKEN',
  DUPLICATE_PAN: 'DUPLICATE_PAN',
  DUPLICATE_NAME: 'DUPLICATE_NAME',
  GSTIN_TAKEN: 'CUSTOMER_GSTIN_TAKEN',
  USER_MISSING: 'CUSTOMER_USER_MISSING',
  OPPORTUNITY_MISSING: 'CUSTOMER_OPPORTUNITY_MISSING',
  VENDOR_MISSING: 'CUSTOMER_VENDOR_MISSING',
  CHILD_ID_EXISTS: 'CUSTOMER_CHILD_ID_EXISTS',
} as const;

export const CUSTOMER_DUPLICATE_REMOVED_ACTION = 'CUSTOMER_DUPLICATE_REMOVED';
export const CUSTOMER_DUPLICATE_RESTORED_ACTION = 'CUSTOMER_DUPLICATE_RESTORED';
export const CUSTOMER_RESTORED_ACTION = 'CUSTOMER_RESTORED';
// What a survivor's history says about a duplicate once that duplicate has been erased for good.
export const CUSTOMER_DUPLICATE_ERASED_REMARK =
  'A duplicate customer was moved to the Recycle Bin and has since been permanently erased.';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// The way names are compared everywhere in customer matching: trimmed, runs of spaces
// collapsed, case ignored.
export const normalizeName = (name: string) =>
  name.trim().replace(/\s+/g, ' ').toLowerCase();

export function customerBlockers(counts: {
  opportunities: number;
  documents: number;
  dispatchOrders: number;
  vendorLink: boolean;
  nameKeyed: number;
  contentShares?: number;
}): DeletionBlocker[] {
  const blockers: DeletionBlocker[] = [];

  if (counts.opportunities > 0) {
    blockers.push({
      code: CUSTOMER_BLOCKER.OPPORTUNITIES,
      count: counts.opportunities,
      message: `It is linked to ${counts.opportunities} ${plural(counts.opportunities, 'opportunity', 'opportunities')}.`,
      hint: 'Take the customer off each deal first (possible until a quotation exists).',
    });
  }

  if (counts.documents > 0) {
    blockers.push({
      code: CUSTOMER_BLOCKER.GST_IN_DOCUMENTS,
      count: counts.documents,
      message: `${counts.documents} ${plural(counts.documents, 'quotation or order uses', 'quotations or orders use')} its GST registrations.`,
      hint: 'Quotations, proforma invoices and sales orders are never deleted.',
    });
  }

  if (counts.dispatchOrders > 0) {
    blockers.push({
      code: CUSTOMER_BLOCKER.DISPATCH_ORDERS,
      count: counts.dispatchOrders,
      message: `${counts.dispatchOrders} ${plural(counts.dispatchOrders, 'dispatch order refers', 'dispatch orders refer')} to it.`,
      hint: 'Dispatch orders are never deleted.',
    });
  }

  if (counts.vendorLink) {
    blockers.push({
      code: CUSTOMER_BLOCKER.VENDOR_LINK,
      count: 1,
      message: 'It is linked to a vendor record.',
      hint: 'A customer that is also a vendor is kept.',
    });
  }

  if (counts.nameKeyed > 0) {
    blockers.push({
      code: CUSTOMER_BLOCKER.NAME_IN_FINANCIAL_RECORDS,
      count: counts.nameKeyed,
      message: `${counts.nameKeyed} ${plural(counts.nameKeyed, 'invoice, ledger entry or dispatch order carries', 'invoices, ledger entries or dispatch orders carry')} its name.`,
      hint: 'Financial records are never deleted, and they refer to a customer by name only, so a customer whose name is on one is kept.',
    });
  }

  const shares = counts.contentShares ?? 0;
  if (shares > 0) {
    blockers.push({
      code: CUSTOMER_BLOCKER.CONTENT_SHARED,
      count: shares,
      message: `Sales content was shared with it ${shares} ${plural(shares, 'time', 'times')}.`,
      hint: 'Content shared with a customer is customer contact and is kept.',
    });
  }

  return blockers;
}

const CUSTOMER_COLUMNS = [
  'id',
  'customerCode',
  'customerName',
  'panNumber',
  'email',
  'phone',
  'customerType',
  'isActive',
  'createdAt',
  'isVendor',
  'linkedVendorId',
  'deactivatedAt',
  'deactivatedById',
  'deactivationReason',
] as const;
const CUSTOMER_DATES = ['createdAt', 'deactivatedAt'] as const;
const GST_COLUMNS = [
  'id',
  'customerId',
  'gstin',
  'legalName',
  'tradeName',
  'branchName',
  'stateCode',
  'stateName',
  'addressLine1',
  'addressLine2',
  'city',
  'pincode',
  'isDefault',
  'isActive',
  'createdAt',
  'updatedAt',
] as const;
const GST_DATES = ['createdAt', 'updatedAt'] as const;
const EVENT_COLUMNS = [
  'id',
  'customerId',
  'action',
  'fromStatus',
  'toStatus',
  'remarks',
  'changes',
  'gstRegistrationId',
  'opportunityId',
  'actorId',
  'occurredAt',
  'createdAt',
] as const;
const EVENT_DATES = ['occurredAt', 'createdAt'] as const;

function readCustomerSnapshot(snapshot: unknown) {
  if (!isRow(snapshot) || !isRow(snapshot.customer)) {
    return null;
  }

  const customer = snapshot.customer;

  if (
    typeof customer.id !== 'string' ||
    typeof customer.customerName !== 'string' ||
    typeof customer.customerCode !== 'string'
  ) {
    return null;
  }

  return {
    customer,
    registrations: rowsOf(snapshot.gstRegistrations),
    events: rowsOf(snapshot.events),
  };
}

async function evaluate(
  db: Db,
  id: string,
): Promise<DeletionEvaluation | null> {
  const customer = await db.customer.findUnique({
    where: { id },
    select: {
      id: true,
      customerCode: true,
      customerName: true,
      isActive: true,
      isVendor: true,
      linkedVendorId: true,
      updatedAt: true,
      gstRegistrations: {
        select: { id: true, legalName: true, tradeName: true, updatedAt: true },
      },
    },
  });

  if (!customer) {
    return null;
  }

  const registrationIds = customer.gstRegistrations.map((r) => r.id);
  const names = [
    ...new Set(
      [
        customer.customerName,
        ...customer.gstRegistrations.flatMap((r) => [r.legalName, r.tradeName]),
      ]
        .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
        .map(normalizeName),
    ),
  ];

  const [
    opportunities,
    quotations,
    orders,
    dispatchOrders,
    vendorsLinked,
    events,
    nameRows,
    contentShares,
  ] = await Promise.all([
    db.opportunity.count({ where: { customerId: id } }),
    registrationIds.length
      ? db.quotation.count({ where: { buyerGstId: { in: registrationIds } } })
      : Promise.resolve(0),
    registrationIds.length
      ? db.salesOrder.count({ where: { buyerGstId: { in: registrationIds } } })
      : Promise.resolve(0),
    db.dispatchOrder.count({ where: { customerId: id } }),
    db.vendor.count({ where: { linkedCustomerId: id } }),
    db.customerEvent.count({ where: { customerId: id } }),
    db.$queryRaw<Array<{ invoices: number; ledger: number; dispatch: number }>>`
      /* customer:deletion-names */
      SELECT
        (SELECT count(*) FROM "SalesInvoice"
          WHERE "customerName" IS NOT NULL
            AND lower(regexp_replace(btrim("customerName"), '[[:space:]]+', ' ', 'g')) IN (${Prisma.join(names)}))::int AS "invoices",
        (SELECT count(*) FROM "CustomerLedger"
          WHERE lower(regexp_replace(btrim("customerName"), '[[:space:]]+', ' ', 'g')) IN (${Prisma.join(names)}))::int AS "ledger",
        (SELECT count(*) FROM "DispatchOrder"
          WHERE "customerName" IS NOT NULL
            AND lower(regexp_replace(btrim("customerName"), '[[:space:]]+', ' ', 'g')) IN (${Prisma.join(names)}))::int AS "dispatch"
    `,
    db.contentShare.count({ where: { customerId: id } }),
  ]);

  const nameKeyed =
    nameRows[0].invoices + nameRows[0].ledger + nameRows[0].dispatch;
  const documents = quotations + orders;
  const vendorLink =
    customer.isVendor || customer.linkedVendorId !== null || vendorsLinked > 0;

  const removes: DeletionLine[] = [
    { label: 'The customer record', count: 1 },
    { label: 'GST registrations', count: customer.gstRegistrations.length },
    { label: 'History events', count: events },
  ].filter((line) => line.count > 0);

  const latestRegistration = customer.gstRegistrations
    .map((r) => r.updatedAt.toISOString())
    .sort()
    .pop();

  return {
    label: customer.customerName,
    code: customer.customerCode,
    blockers: customerBlockers({
      opportunities,
      documents,
      dispatchOrders,
      vendorLink,
      nameKeyed,
      contentShares,
    }),
    removes,
    version: versionOf({
      updatedAt: customer.updatedAt.toISOString(),
      isActive: customer.isActive,
      registrations: customer.gstRegistrations.length,
      latestRegistration: latestRegistration ?? null,
      events,
      opportunities,
      documents,
      dispatchOrders,
      vendorLink,
      nameKeyed,
      contentShares,
    }),
  };
}

export const CUSTOMER_DELETION_POLICY: DeletionPolicy = {
  entityType: DELETION_ENTITY.CUSTOMER,
  noun: 'customer',
  notFoundMessage: 'Customer not found.',
  blockerCodes: Object.values(CUSTOMER_BLOCKER),

  async lockRows(tx, ids) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      /* customer:lock-for-deletion */
      SELECT "id"
      FROM "Customer"
      WHERE "id" IN (${Prisma.join(ids)})
      ORDER BY "id"
      FOR UPDATE
    `;

    return rows.map((row) => row.id);
  },

  evaluate,

  async survivorLabel(db, id) {
    const customer = await db.customer.findUnique({
      where: { id },
      select: { customerName: true },
    });

    return customer?.customerName ?? null;
  },

  async capture(db, id) {
    const customer = await db.customer.findUniqueOrThrow({ where: { id } });

    const [gstRegistrations, events] = await Promise.all([
      db.customerGSTRegistration.findMany({
        where: { customerId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      db.customerEvent.findMany({
        where: { customerId: id },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const personIds = uniqueStrings([
      customer.deactivatedById,
      ...events.map((event) => event.actorId),
    ]);

    const people = await db.user.findMany({
      where: { id: { in: personIds } },
      select: { id: true, fullName: true, email: true },
    });

    return JSON.parse(
      JSON.stringify({
        schemaVersion: 1,
        customer,
        gstRegistrations,
        events,
        people,
      }),
    ) as Prisma.InputJsonValue;
  },

  // The events refer to the registrations, so they go first.
  async remove(tx, id) {
    await tx.customerEvent.deleteMany({ where: { customerId: id } });
    await tx.customerGSTRegistration.deleteMany({ where: { customerId: id } });
    await tx.customer.delete({ where: { id } });
  },

  async restoreEvaluate(db, snapshot, record): Promise<RestoreEvaluation> {
    const snap = readCustomerSnapshot(snapshot);

    if (!snap) {
      return {
        conflicts: [
          {
            code: CUSTOMER_RESTORE_CONFLICT.SNAPSHOT_INVALID,
            message: 'The saved copy of this customer is not readable.',
          },
        ],
        restores: [],
        facts: {},
      };
    }

    const { customer, registrations, events } = snap;
    const conflicts: RestoreConflict[] = [];

    if (
      await db.customer.findUnique({
        where: { id: record.entityId },
        select: { id: true },
      })
    ) {
      conflicts.push({
        code: CUSTOMER_RESTORE_CONFLICT.ID_EXISTS,
        message: 'A customer with this identity already exists.',
      });
    }

    const sameCode = await db.customer.findUnique({
      where: { customerCode: customer.customerCode as string },
      select: { customerName: true },
    });

    if (sameCode) {
      conflicts.push({
        code: CUSTOMER_RESTORE_CONFLICT.CODE_TAKEN,
        message: `Its customer code ${customer.customerCode as string} is now used by "${sameCode.customerName}".`,
      });
    }

    // The same rules a new customer is held to: a PAN or a name that another customer
    // has now is a duplicate.
    const matches = await findCustomerMatches(db, {
      name: customer.customerName as string,
      pan: typeof customer.panNumber === 'string' ? customer.panNumber : null,
      phone: null,
      email: null,
    });

    for (const match of matches) {
      if (match.panMatch) {
        conflicts.push({
          code: CUSTOMER_RESTORE_CONFLICT.DUPLICATE_PAN,
          message: `Another customer, "${match.customerName}" (${match.customerCode}), now has the same PAN.`,
        });
      }

      if (match.nameMatch) {
        conflicts.push({
          code: CUSTOMER_RESTORE_CONFLICT.DUPLICATE_NAME,
          message: `Another customer, "${match.customerName}" (${match.customerCode}), now has the same name.`,
        });
      }
    }

    const gstins = uniqueStrings(registrations.map((row) => row.gstin));
    const takenGstins = gstins.length
      ? await db.customerGSTRegistration.findMany({
          where: { gstin: { in: gstins } },
          select: { gstin: true },
        })
      : [];

    for (const taken of takenGstins) {
      conflicts.push({
        code: CUSTOMER_RESTORE_CONFLICT.GSTIN_TAKEN,
        message: `Its GSTIN ${taken.gstin} is now registered to another customer.`,
      });
    }

    const personIds = uniqueStrings([
      customer.deactivatedById,
      ...events.map((row) => row.actorId),
    ]);
    const people = personIds.length
      ? await db.user.findMany({
          where: { id: { in: personIds } },
          select: { id: true },
        })
      : [];

    if (people.length !== personIds.length) {
      conflicts.push({
        code: CUSTOMER_RESTORE_CONFLICT.USER_MISSING,
        message:
          'A person named in its history (who acted on it) no longer exists.',
      });
    }

    const opportunityIds = uniqueStrings(
      events.map((row) => row.opportunityId),
    );
    const opportunities = opportunityIds.length
      ? await db.opportunity.count({ where: { id: { in: opportunityIds } } })
      : 0;

    if (opportunities !== opportunityIds.length) {
      conflicts.push({
        code: CUSTOMER_RESTORE_CONFLICT.OPPORTUNITY_MISSING,
        message: 'An opportunity named in its history no longer exists.',
      });
    }

    if (typeof customer.linkedVendorId === 'string') {
      const vendor = await db.vendor.count({
        where: { id: customer.linkedVendorId },
      });

      if (vendor === 0) {
        conflicts.push({
          code: CUSTOMER_RESTORE_CONFLICT.VENDOR_MISSING,
          message: 'The vendor it was linked to no longer exists.',
        });
      }
    }

    const clash =
      (await db.customerGSTRegistration.count({
        where: { id: { in: idsOf(registrations) } },
      })) +
      (await db.customerEvent.count({ where: { id: { in: idsOf(events) } } }));

    if (clash > 0) {
      conflicts.push({
        code: CUSTOMER_RESTORE_CONFLICT.CHILD_ID_EXISTS,
        message: 'Part of its history already exists under the same identity.',
      });
    }

    const restores: DeletionLine[] = [
      { label: 'The customer record', count: 1 },
      { label: 'GST registrations', count: registrations.length },
      { label: 'History events', count: events.length },
    ].filter((line) => line.count > 0);

    return {
      conflicts,
      restores,
      facts: { registrations: registrations.length, events: events.length },
    };
  },

  // The same name lock a new customer takes, so a customer of the same name cannot be
  // created between the duplicate check and the restore.
  async lockForRestore(tx, snapshot) {
    const snap = readCustomerSnapshot(snapshot);

    if (snap) {
      await lockCustomerName(tx, snap.customer.customerName as string);
    }
  },

  async restore(tx, snapshot, context) {
    const snap = readCustomerSnapshot(snapshot);

    if (!snap) {
      throw new Error('The saved copy of this customer is not readable.');
    }

    await tx.customer.create({
      data: {
        ...(reviveRow(
          snap.customer,
          CUSTOMER_COLUMNS,
          CUSTOMER_DATES,
        ) as Prisma.CustomerUncheckedCreateInput),
        updatedAt: context.now,
      },
    });

    await tx.customerGSTRegistration.createMany({
      data: snap.registrations.map(
        (row) =>
          reviveRow(
            row,
            GST_COLUMNS,
            GST_DATES,
          ) as Prisma.CustomerGSTRegistrationCreateManyInput,
      ),
    });

    await tx.customerEvent.createMany({
      data: snap.events.map((row) => {
        const revived = reviveRow(row, EVENT_COLUMNS, EVENT_DATES);

        // A JSON column that was null is left out (null is not a JSON value to Prisma).
        if (revived.changes === null) {
          delete revived.changes;
        }

        return revived as Prisma.CustomerEventCreateManyInput;
      }),
    });

    await recordCustomerEvent(tx, {
      customerId: snap.customer.id as string,
      action: CUSTOMER_RESTORED_ACTION,
      remarks: `Customer restored from the Recycle Bin. It had been deleted earlier.`,
      actorId: context.actorId,
      occurredAt: context.now,
    });
  },

  async recordSurvivorRestored(tx, event) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      /* customer:lock-survivor */
      SELECT "id" FROM "Customer" WHERE "id" = ${event.survivorId} FOR SHARE
    `;

    if (rows.length === 0) {
      return;
    }

    await recordCustomerEvent(tx, {
      customerId: event.survivorId,
      action: CUSTOMER_DUPLICATE_RESTORED_ACTION,
      remarks: `Customer "${event.restoredLabel}", deleted earlier as a duplicate of this customer, was restored.`,
      actorId: event.actorId,
      occurredAt: new Date(),
    });
  },

  // The history entries that named the erased duplicate become neutral; they are found by
  // their exact text, so entries about other duplicates are not touched.
  async redactSurvivorEvents(tx, event) {
    await tx.customerEvent.updateMany({
      where: {
        customerId: event.survivorId,
        action: CUSTOMER_DUPLICATE_REMOVED_ACTION,
        remarks: `Duplicate customer "${event.removedLabel}" was moved to the Recycle Bin.`,
      },
      data: { remarks: CUSTOMER_DUPLICATE_ERASED_REMARK },
    });
    await tx.customerEvent.updateMany({
      where: {
        customerId: event.survivorId,
        action: CUSTOMER_DUPLICATE_RESTORED_ACTION,
        remarks: `Customer "${event.removedLabel}", deleted earlier as a duplicate of this customer, was restored.`,
      },
      data: { remarks: CUSTOMER_DUPLICATE_ERASED_REMARK },
    });
  },

  async recordSurvivorEvent(tx, event) {
    await recordCustomerEvent(tx, {
      customerId: event.survivorId,
      action: CUSTOMER_DUPLICATE_REMOVED_ACTION,
      remarks: `Duplicate customer "${event.removedLabel}" was moved to the Recycle Bin.`,
      actorId: event.actorId,
      occurredAt: new Date(),
    });
  },
};

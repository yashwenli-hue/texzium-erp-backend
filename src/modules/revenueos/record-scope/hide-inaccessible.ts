import { ConflictException } from '@nestjs/common';

import { PrismaClient } from '@prisma/client';

import {
  customerCreators,
  customerSalesperson,
  customerSalespeople,
} from '../customer-master/customer-relationship';
import { RecordScope, isVisible } from './record-scope';

// A refusal that names an existing customer (duplicate GSTIN, PAN or name) must not show
// that customer to someone who may not see it. The refusal itself stands - it is what
// prevents the duplicate - but its name, code and id are taken out and the person is told
// to ask for access instead. The salesperson who looks after that customer is named
// (mappedTo), so the enquiry can be routed to them - knowing who looks after it does not
// give access to it.

const HIDDEN_MESSAGE: Record<string, string> = {
  DUPLICATE_GSTIN:
    'This GSTIN is already registered to a customer you do not have access to. Ask an administrator to give you access instead of creating another customer.',
  DUPLICATE_PAN:
    'A customer with this PAN already exists, but it is not one you have access to. Ask an administrator to give you access instead of creating another customer.',
  DUPLICATE_NAME:
    'A customer with this name already exists, but it is not one you have access to. Ask an administrator for access, or make the name distinct.',
};
const FALLBACK =
  'This matches a customer you do not have access to. Ask an administrator for access.';

type Db = Parameters<typeof isVisible>[0] &
  Pick<PrismaClient, 'opportunity' | 'customerEvent'>;

export async function hideInaccessibleCustomer<T>(
  db: Db,
  scope: RecordScope,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof ConflictException)) throw error;
    const body = error.getResponse() as Record<string, unknown>;
    const existing =
      body && typeof body === 'object'
        ? (body.existing as Record<string, unknown> | undefined)
        : undefined;
    const customerId =
      typeof existing?.customerId === 'string'
        ? existing.customerId
        : typeof existing?.id === 'string'
          ? existing.id
          : null;
    if (!customerId) throw error;
    const mappedTo =
      (await customerSalespeople(db, [customerId])).get(customerId) ?? [];
    const salesperson = (await customerSalesperson(db, [customerId])).get(
      customerId,
    );
    // A customer the caller may see: the refusal names it as before, and also who looks
    // after it and who created it (two different facts; either may be unknown).
    if (scope.all || (await isVisible(db, scope, 'customer', customerId))) {
      const createdBy =
        (await customerCreators(db, [customerId])).get(customerId) ?? null;
      throw new ConflictException({
        ...body,
        mappedTo,
        salesperson,
        createdBy,
      });
    }
    const { existing: _hidden, ...rest } = body;
    void _hidden;
    const code = typeof rest.code === 'string' ? rest.code : '';
    throw new ConflictException({
      ...rest,
      message: HIDDEN_MESSAGE[code] ?? FALLBACK,
      existingHidden: true,
      mappedTo,
      salesperson,
    });
  }
}

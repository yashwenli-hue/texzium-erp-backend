import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { conflict } from '../customer-master/customer-lifecycle';

// The lifecycle of a customer's GST registration:
//
//   ACTIVE <-> INACTIVE
//
// "CustomerGSTRegistration"."isActive" is the source of truth. A registration
// is never deleted: documents refer to it. Deactivating needs a reason. A
// customer that has an active registration has exactly one active default,
// which the service maintains under the customer's row lock (and the database
// backs up with a partial unique index): the first registration becomes the
// default, a deactivated registration is never the default, and the default
// cannot be deactivated while another registration is active.
export const GST_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

export const GST_NOT_FOUND_MESSAGE = 'GST registration not found.';

export const GST_CONFLICT_CODE = {
  DUPLICATE_GSTIN: 'DUPLICATE_GSTIN',
  GST_ALREADY_INACTIVE: 'GST_ALREADY_INACTIVE',
  GST_ALREADY_ACTIVE: 'GST_ALREADY_ACTIVE',
  GST_INACTIVE: 'GST_INACTIVE',
  GST_IS_DEFAULT: 'GST_IS_DEFAULT',
} as const;

export const GST_BAD_REQUEST_CODE = {
  INVALID_STATE_CODE: 'INVALID_STATE_CODE',
  GSTIN_PAN_MISMATCH: 'GSTIN_PAN_MISMATCH',
} as const;

export const GST_CUSTOMER_INACTIVE_MESSAGE =
  'This customer is inactive. Reactivate it before changing its GST registrations.';

export type ExistingRegistration = {
  id: string;
  gstin: string;
  customerId: string;
  customerCode: string;
  customerName: string;
};

export function notFoundGst(): NotFoundException {
  return new NotFoundException(GST_NOT_FOUND_MESSAGE);
}

function badRequest(message: string, code: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message,
    code,
  });
}

export function badRequestInvalidState(gstin: string): BadRequestException {
  return badRequest(
    `The GSTIN ${gstin} does not start with a valid GST state code.`,
    GST_BAD_REQUEST_CODE.INVALID_STATE_CODE,
  );
}

export function badRequestPanMismatch(
  gstin: string,
  customerPan: string,
): BadRequestException {
  return badRequest(
    `The GSTIN ${gstin} carries a different PAN from this customer's (${customerPan}).`,
    GST_BAD_REQUEST_CODE.GSTIN_PAN_MISMATCH,
  );
}

export function conflictDuplicateGstin(
  gstin: string,
  existing?: ExistingRegistration,
): ConflictException {
  return conflict(
    existing
      ? `The GSTIN ${gstin} is already registered to ${existing.customerName} (${existing.customerCode}).`
      : `The GSTIN ${gstin} is already registered.`,
    GST_CONFLICT_CODE.DUPLICATE_GSTIN,
    undefined,
    existing ? { existing } : undefined,
  );
}

export function conflictGstAlreadyInactive(): ConflictException {
  return conflict(
    'This GST registration is already inactive.',
    GST_CONFLICT_CODE.GST_ALREADY_INACTIVE,
  );
}

export function conflictGstAlreadyActive(): ConflictException {
  return conflict(
    'This GST registration is already active.',
    GST_CONFLICT_CODE.GST_ALREADY_ACTIVE,
  );
}

export function conflictGstInactive(message: string): ConflictException {
  return conflict(message, GST_CONFLICT_CODE.GST_INACTIVE);
}

export function conflictGstIsDefault(): ConflictException {
  return conflict(
    'This is the default GST registration. Make another registration the default first.',
    GST_CONFLICT_CODE.GST_IS_DEFAULT,
  );
}

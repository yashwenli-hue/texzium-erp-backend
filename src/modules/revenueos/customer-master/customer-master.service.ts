import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  DeactivateCustomerDto,
  ReactivateCustomerDto,
} from './dto/customer-lifecycle.dto';
import { CustomerDuplicateCheckQueryDto } from './dto/customer-duplicate-check.dto';
import {
  CUSTOMER_ACTOR_SELECT,
  CUSTOMER_EVENT_ACTION,
  CUSTOMER_INCLUDE,
  CUSTOMER_NOT_FOUND_MESSAGE,
  CUSTOMER_STATUS,
  assertNoBlockingDuplicate,
  conflictAlreadyActive,
  conflictAlreadyInactive,
  conflictCustomerInactive,
  conflictPanMismatchesGst,
  conflictDuplicatePan,
  conflictDuplicateCustomerGstin,
  findCustomerMatches,
  isUniqueViolation,
  lockCustomer,
  lockCustomerName,
  matchReasons,
  matchStrength,
  recordCustomerEvent,
  requireCustomer,
  requireCustomerActor,
  takeCustomerCodeNumber,
  CustomerMatch,
} from './customer-lifecycle';
import {
  GSTIN_PATTERN,
  gstinMatchesPan,
  gstinState,
} from '../customer-gst/customer-gst-values';
import {
  GST_STATUS,
  badRequestInvalidState,
  badRequestPanMismatch,
} from '../customer-gst/customer-gst-lifecycle';
import {
  CUSTOMER_EDITABLE_FIELDS,
  CustomerEditableField,
  diffCustomerFields,
  formatCustomerCode,
  normalizeEmail,
  normalizePan,
} from './customer-values';
import {
  ALL_RECORDS,
  RecordScope,
  customerWhere,
} from '../record-scope/record-scope';

// A code is taken from a sequence, so a clash can only come from a code
// written by hand elsewhere. A new number is tried a few times before giving up.
const CODE_ATTEMPTS = 3;

@Injectable()
export class CustomerMasterService {
  constructor(private prisma: PrismaService) {}

  // Creates an active customer with a server-assigned code, and the event that
  // starts its history. A customer with the same PAN, or the same name, is a
  // conflict: another site of the same business is a GST registration of the
  // existing customer, not a second customer.
  async create(data: CreateCustomerDto, actorId: string | undefined) {
    const actor = await requireCustomerActor(this.prisma, actorId);

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.createOnce(data, actor.id);
      } catch (error) {
        if (
          isUniqueViolation(error, 'customerCode') &&
          attempt < CODE_ATTEMPTS
        ) {
          continue;
        }

        // The database's backstop for a PAN that was taken between the check
        // and the insert.
        if (isUniqueViolation(error, 'panNumber')) {
          throw conflictDuplicatePan();
        }

        // ... and for a GSTIN registered by a request that overlapped this one.
        if (isUniqueViolation(error, 'gstin')) {
          throw conflictDuplicateCustomerGstin();
        }

        throw error;
      }
    }
  }

  private createOnce(data: CreateCustomerDto, actorId: string) {
    const gst = data.gstRegistration;

    // The first registration is checked before anything is written.
    const state = gst ? gstinState(gst.gstin) : null;
    if (gst && !state) throw badRequestInvalidState(gst.gstin);
    if (gst && !gstinMatchesPan(gst.gstin, data.panNumber ?? null)) {
      throw badRequestPanMismatch(gst.gstin, data.panNumber!);
    }

    return this.prisma.$transaction(async (tx) => {
      await lockCustomerName(tx, data.customerName);

      // Two creations with the same GSTIN run one after the other, so the second sees
      // the first (the unique index on the GSTIN is the backstop).
      if (gst) {
        await tx.$executeRaw`
          /* customer:gstin-lock */
          SELECT pg_advisory_xact_lock(hashtext('customer-gstin:' || ${gst.gstin}::text))
        `;
      }

      assertNoBlockingDuplicate(
        await findCustomerMatches(tx, {
          name: data.customerName,
          pan: data.panNumber ?? null,
          phone: null,
          email: null,
          gstin: gst?.gstin ?? null,
        }),
      );

      const customer = await tx.customer.create({
        data: {
          customerCode: formatCustomerCode(await takeCustomerCodeNumber(tx)),
          customerName: data.customerName,
          customerType: data.customerType,
          panNumber: data.panNumber,
          email: data.email,
          phone: data.phone,
        },
        include: CUSTOMER_INCLUDE,
      });

      await recordCustomerEvent(tx, {
        customerId: customer.id,
        action: CUSTOMER_EVENT_ACTION.CUSTOMER_CREATED,
        toStatus: CUSTOMER_STATUS.ACTIVE,
        actorId,
        occurredAt: customer.createdAt,
      });

      if (!gst || !state) return customer;

      const registration = await tx.customerGSTRegistration.create({
        data: {
          customerId: customer.id,
          gstin: gst.gstin,
          legalName: gst.legalName,
          tradeName: gst.tradeName,
          branchName: gst.branchName,
          stateCode: state.stateCode,
          stateName: state.stateName,
          addressLine1: gst.addressLine1,
          addressLine2: gst.addressLine2,
          city: gst.city,
          pincode: gst.pincode,
          isDefault: true,
          isActive: true,
        },
      });

      await recordCustomerEvent(tx, {
        customerId: customer.id,
        action: CUSTOMER_EVENT_ACTION.GST_ADDED,
        toStatus: GST_STATUS.ACTIVE,
        gstRegistrationId: registration.id,
        actorId,
        occurredAt: registration.createdAt,
      });

      return tx.customer.findUniqueOrThrow({
        where: { id: customer.id },
        include: CUSTOMER_INCLUDE,
      });
    });
  }

  async findAll(scope: RecordScope = ALL_RECORDS) {
    return this.prisma.customer.findMany({
      where: customerWhere(scope),
      include: CUSTOMER_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: CUSTOMER_INCLUDE,
    });

    if (!customer) {
      throw new NotFoundException(CUSTOMER_NOT_FOUND_MESSAGE);
    }

    return customer;
  }

  // Lifecycle history of one customer, newest first.
  async findEvents(id: string) {
    await requireCustomer(this.prisma, id);

    return this.prisma.customerEvent.findMany({
      where: { customerId: id },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: {
        actor: { select: CUSTOMER_ACTOR_SELECT },
        gstRegistration: {
          select: { id: true, gstin: true, branchName: true, legalName: true },
        },
      },
    });
  }

  // Customers that look like the one described, for a form to warn before it
  // saves. PAN and name matches are what create/edit refuse; phone and email
  // only warn. Nothing is written.
  // A scoped caller still learns that a match exists (that is what prevents the duplicate),
  // but not which customer it is when it is one they may not see.
  async duplicateCheck(
    query: CustomerDuplicateCheckQueryDto,
    scope: RecordScope = ALL_RECORDS,
  ) {
    const { customerName, panNumber, phone, email } = query;
    // Only a complete GSTIN is compared: a half-typed one is a valid question that
    // matches nothing.
    const gstin =
      query.gstin && GSTIN_PATTERN.test(query.gstin) ? query.gstin : null;

    if (!customerName && !panNumber && !phone && !email && !query.gstin) {
      throw new BadRequestException(
        'Give at least one of customerName, panNumber, phone, email or gstin.',
      );
    }

    const matches = await findCustomerMatches(this.prisma, {
      name: customerName ?? null,
      pan: panNumber ? normalizePan(panNumber) : null,
      phone: phone ?? null,
      email: email ? normalizeEmail(email) : null,
      gstin,
      excludeId: query.excludeCustomerId ?? null,
    });

    const visible = scope.all
      ? null
      : new Set(
          (
            await this.prisma.customer.findMany({
              where: {
                AND: [
                  { id: { in: matches.map((m) => m.id) } },
                  customerWhere(scope) ?? {},
                ],
              },
              select: { id: true },
            })
          ).map((c) => c.id),
        );

    const present = (m: CustomerMatch) =>
      !visible || visible.has(m.id)
        ? {
            id: m.id,
            customerCode: m.customerCode,
            customerName: m.customerName,
            isActive: m.isActive,
            reasons: matchReasons(m),
            strength: matchStrength(m),
          }
        : {
            id: null,
            customerCode: null,
            customerName: null,
            isActive: null,
            hidden: true,
            reasons: matchReasons(m),
            strength: matchStrength(m),
          };

    const blocks = (m: CustomerMatch) =>
      m.gstinMatch || m.panMatch || m.nameMatch;

    return {
      blocking: matches.filter(blocks).map(present),
      warnings: matches.filter((m) => !blocks(m)).map(present),
    };
  }

  // Edits the customer's own details. Only the fields that really change are
  // written, and they are recorded on the event as { field: { from, to } }.
  // Sending nothing, or the values already stored, changes nothing and records
  // nothing. An inactive customer cannot be edited.
  async update(
    id: string,
    actorId: string | undefined,
    data: UpdateCustomerDto,
  ) {
    const actor = await requireCustomerActor(this.prisma, actorId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await lockCustomer(tx, id);

        if (!locked.isActive) {
          throw conflictCustomerInactive();
        }

        const current = await tx.customer.findUniqueOrThrow({
          where: { id },
          select: {
            customerName: true,
            customerType: true,
            panNumber: true,
            email: true,
            phone: true,
          },
        });

        const requested: Partial<Record<CustomerEditableField, string | null>> =
          {};

        for (const field of CUSTOMER_EDITABLE_FIELDS) {
          if (data[field] !== undefined) requested[field] = data[field];
        }

        const changes = diffCustomerFields(current, requested);
        const changedFields = Object.keys(changes) as CustomerEditableField[];

        if (changedFields.length === 0) {
          return tx.customer.findUniqueOrThrow({
            where: { id },
            include: CUSTOMER_INCLUDE,
          });
        }

        const newName = changes.customerName?.to ?? null;
        const newPan = changes.panNumber?.to ?? null;

        if (newName !== null) {
          await lockCustomerName(tx, newName);
        }

        if (newName !== null || newPan !== null) {
          assertNoBlockingDuplicate(
            await findCustomerMatches(tx, {
              name: newName,
              pan: newPan,
              phone: null,
              email: null,
              excludeId: id,
            }),
          );
        }

        // A customer's PAN and the GSTINs of its active registrations must
        // keep agreeing (a GSTIN carries its holder's PAN).
        if (newPan !== null) {
          const registrations = await tx.customerGSTRegistration.findMany({
            where: { customerId: id, isActive: true },
            select: { gstin: true },
          });

          if (registrations.some((r) => !gstinMatchesPan(r.gstin, newPan))) {
            throw conflictPanMismatchesGst();
          }
        }

        const updated = await tx.customer.update({
          where: { id },
          data: Object.fromEntries(
            changedFields.map((field) => [field, changes[field]!.to]),
          ),
          include: CUSTOMER_INCLUDE,
        });

        await recordCustomerEvent(tx, {
          customerId: id,
          action: CUSTOMER_EVENT_ACTION.CUSTOMER_UPDATED,
          fromStatus: CUSTOMER_STATUS.ACTIVE,
          toStatus: CUSTOMER_STATUS.ACTIVE,
          changes,
          actorId: actor.id,
          occurredAt: updated.updatedAt,
        });

        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'panNumber')) {
        throw conflictDuplicatePan();
      }

      throw error;
    }
  }

  // ACTIVE -> INACTIVE. The reason is mandatory. Nothing else is touched: the
  // customer's documents, registrations and history all stay.
  async deactivate(
    id: string,
    actorId: string | undefined,
    data: DeactivateCustomerDto,
  ) {
    const actor = await requireCustomerActor(this.prisma, actorId);

    return this.prisma.$transaction(async (tx) => {
      const locked = await lockCustomer(tx, id);

      if (!locked.isActive) {
        throw conflictAlreadyInactive();
      }

      const now = new Date();

      const result = await tx.customer.updateMany({
        where: { id, isActive: true },
        data: {
          isActive: false,
          deactivatedAt: now,
          deactivatedById: actor.id,
          deactivationReason: data.reason,
        },
      });

      if (result.count === 0) {
        throw conflictAlreadyInactive();
      }

      await recordCustomerEvent(tx, {
        customerId: id,
        action: CUSTOMER_EVENT_ACTION.CUSTOMER_DEACTIVATED,
        fromStatus: CUSTOMER_STATUS.ACTIVE,
        toStatus: CUSTOMER_STATUS.INACTIVE,
        remarks: data.reason,
        actorId: actor.id,
        occurredAt: now,
      });

      return tx.customer.findUniqueOrThrow({
        where: { id },
        include: CUSTOMER_INCLUDE,
      });
    });
  }

  // INACTIVE -> ACTIVE. The current deactivation is cleared; the event keeps
  // the history of it.
  async reactivate(
    id: string,
    actorId: string | undefined,
    data: ReactivateCustomerDto,
  ) {
    const actor = await requireCustomerActor(this.prisma, actorId);

    return this.prisma.$transaction(async (tx) => {
      const locked = await lockCustomer(tx, id);

      if (locked.isActive) {
        throw conflictAlreadyActive();
      }

      const now = new Date();

      const result = await tx.customer.updateMany({
        where: { id, isActive: false },
        data: {
          isActive: true,
          deactivatedAt: null,
          deactivatedById: null,
          deactivationReason: null,
        },
      });

      if (result.count === 0) {
        throw conflictAlreadyActive();
      }

      await recordCustomerEvent(tx, {
        customerId: id,
        action: CUSTOMER_EVENT_ACTION.CUSTOMER_REACTIVATED,
        fromStatus: CUSTOMER_STATUS.INACTIVE,
        toStatus: CUSTOMER_STATUS.ACTIVE,
        remarks: data.remarks,
        actorId: actor.id,
        occurredAt: now,
      });

      return tx.customer.findUniqueOrThrow({
        where: { id },
        include: CUSTOMER_INCLUDE,
      });
    });
  }
}

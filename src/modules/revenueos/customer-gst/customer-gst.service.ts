import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../core/database/prisma.service';
import {
  CUSTOMER_EVENT_ACTION,
  conflictCustomerInactive,
  isUniqueViolation,
  lockCustomer,
  recordCustomerEvent,
  requireCustomerActor,
} from '../customer-master/customer-lifecycle';
import { CreateCustomerGstDto } from './dto/create-customer-gst.dto';
import { UpdateCustomerGstDto } from './dto/update-customer-gst.dto';
import {
  DeactivateCustomerGstDto,
  ReactivateCustomerGstDto,
} from './dto/customer-gst-lifecycle.dto';
import {
  GST_CUSTOMER_INACTIVE_MESSAGE,
  GST_STATUS,
  badRequestInvalidState,
  badRequestPanMismatch,
  conflictDuplicateGstin,
  conflictGstAlreadyActive,
  conflictGstAlreadyInactive,
  conflictGstInactive,
  conflictGstIsDefault,
  notFoundGst,
} from './customer-gst-lifecycle';
import {
  GST_EDITABLE_FIELDS,
  GstEditableField,
  diffGstFields,
  gstinMatchesPan,
  gstinState,
} from './customer-gst-values';
import {
  ALL_RECORDS,
  RecordScope,
  gstRegistrationWhere,
} from '../record-scope/record-scope';

type Tx = Prisma.TransactionClient;

// Only these fields of the owning customer leave this API with a registration.
const GST_CUSTOMER_SELECT = {
  id: true,
  customerCode: true,
  customerName: true,
  isActive: true,
} satisfies Prisma.CustomerSelect;

// What a GSTIN clash reports about the registration that already holds it.
const EXISTING_SELECT = {
  id: true,
  gstin: true,
  customerId: true,
  customer: { select: { customerCode: true, customerName: true } },
} satisfies Prisma.CustomerGSTRegistrationSelect;

@Injectable()
export class CustomerGstService {
  constructor(private prisma: PrismaService) {}

  // Adds a registration to a customer. The state is read from the GSTIN, and a
  // GSTIN is registered to one customer only. The customer's first registration
  // is its default; asking for the default takes it over from the current one.
  async create(data: CreateCustomerGstDto, actorId: string | undefined) {
    const actor = await requireCustomerActor(this.prisma, actorId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await lockCustomer(tx, data.customerId);

        if (!locked.isActive) {
          throw conflictCustomerInactive(GST_CUSTOMER_INACTIVE_MESSAGE);
        }

        const customer = await tx.customer.findUniqueOrThrow({
          where: { id: data.customerId },
          select: { panNumber: true },
        });

        const state = gstinState(data.gstin);

        if (!state) {
          throw badRequestInvalidState(data.gstin);
        }

        if (!gstinMatchesPan(data.gstin, customer.panNumber)) {
          throw badRequestPanMismatch(data.gstin, customer.panNumber!);
        }

        const taken = await tx.customerGSTRegistration.findUnique({
          where: { gstin: data.gstin },
          select: EXISTING_SELECT,
        });

        if (taken) {
          throw conflictDuplicateGstin(data.gstin, this.toExisting(taken));
        }

        const currentDefault = await tx.customerGSTRegistration.findFirst({
          where: {
            customerId: data.customerId,
            isActive: true,
            isDefault: true,
          },
          select: { id: true, gstin: true },
        });

        const makeDefault = !currentDefault || data.isDefault === true;

        // Unset before inserting: the database allows one active default.
        if (makeDefault && currentDefault) {
          await tx.customerGSTRegistration.updateMany({
            where: { id: currentDefault.id, isDefault: true },
            data: { isDefault: false },
          });
        }

        const registration = await tx.customerGSTRegistration.create({
          data: {
            customerId: data.customerId,
            gstin: data.gstin,
            legalName: data.legalName,
            tradeName: data.tradeName,
            branchName: data.branchName,
            stateCode: state.stateCode,
            stateName: state.stateName,
            addressLine1: data.addressLine1,
            addressLine2: data.addressLine2,
            city: data.city,
            pincode: data.pincode,
            isDefault: makeDefault,
            isActive: true,
          },
        });

        await recordCustomerEvent(tx, {
          customerId: data.customerId,
          action: CUSTOMER_EVENT_ACTION.GST_ADDED,
          toStatus: GST_STATUS.ACTIVE,
          gstRegistrationId: registration.id,
          actorId: actor.id,
          occurredAt: registration.createdAt,
        });

        if (makeDefault && currentDefault) {
          await this.recordDefaultChange(
            tx,
            registration.customerId,
            registration.id,
            currentDefault.gstin,
            registration.gstin,
            actor.id,
            registration.createdAt,
          );
        }

        return registration;
      });
    } catch (error) {
      // The database's backstop for a GSTIN taken between the check and the
      // insert.
      if (isUniqueViolation(error, 'gstin')) {
        const taken = await this.prisma.customerGSTRegistration.findUnique({
          where: { gstin: data.gstin },
          select: EXISTING_SELECT,
        });

        throw conflictDuplicateGstin(
          data.gstin,
          taken ? this.toExisting(taken) : undefined,
        );
      }

      throw error;
    }
  }

  async findAll(scope: RecordScope = ALL_RECORDS) {
    return this.prisma.customerGSTRegistration.findMany({
      where: gstRegistrationWhere(scope),
      include: { customer: { select: GST_CUSTOMER_SELECT } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async findOne(id: string) {
    const registration = await this.prisma.customerGSTRegistration.findUnique({
      where: { id },
      include: { customer: { select: GST_CUSTOMER_SELECT } },
    });

    if (!registration) {
      throw notFoundGst();
    }

    return registration;
  }

  // Edits the details of a registration. Only the fields that really change
  // are written, and they are recorded as { field: { from, to } }. Sending
  // nothing, or the values already stored, changes nothing and records
  // nothing. An inactive registration cannot be edited.
  async update(
    id: string,
    actorId: string | undefined,
    data: UpdateCustomerGstDto,
  ) {
    const actor = await requireCustomerActor(this.prisma, actorId);

    return this.withRegistration(id, async (tx, registration) => {
      if (!registration.isActive) {
        throw conflictGstInactive(
          'This GST registration is inactive. Reactivate it to edit it.',
        );
      }

      const requested: Partial<Record<GstEditableField, string | null>> = {};

      for (const field of GST_EDITABLE_FIELDS) {
        if (data[field] !== undefined) requested[field] = data[field];
      }

      const changes = diffGstFields(registration, requested);
      const changedFields = Object.keys(changes) as GstEditableField[];

      if (changedFields.length === 0) {
        return registration;
      }

      const updated = await tx.customerGSTRegistration.update({
        where: { id },
        data: Object.fromEntries(
          changedFields.map((field) => [field, changes[field]!.to]),
        ),
      });

      await recordCustomerEvent(tx, {
        customerId: registration.customerId,
        action: CUSTOMER_EVENT_ACTION.GST_UPDATED,
        fromStatus: GST_STATUS.ACTIVE,
        toStatus: GST_STATUS.ACTIVE,
        changes,
        gstRegistrationId: id,
        actorId: actor.id,
        occurredAt: updated.updatedAt,
      });

      return updated;
    });
  }

  // ACTIVE -> INACTIVE. The reason is mandatory. The default cannot be
  // deactivated while another registration is active (choose a new default
  // first); the only active registration can be, and then it is no longer the
  // default.
  async deactivate(
    id: string,
    actorId: string | undefined,
    data: DeactivateCustomerGstDto,
  ) {
    const actor = await requireCustomerActor(this.prisma, actorId);

    return this.withRegistration(id, async (tx, registration) => {
      if (!registration.isActive) {
        throw conflictGstAlreadyInactive();
      }

      if (registration.isDefault) {
        const others = await tx.customerGSTRegistration.count({
          where: {
            customerId: registration.customerId,
            isActive: true,
            id: { not: id },
          },
        });

        if (others > 0) {
          throw conflictGstIsDefault();
        }
      }

      const now = new Date();

      const result = await tx.customerGSTRegistration.updateMany({
        where: { id, isActive: true },
        data: { isActive: false, isDefault: false },
      });

      if (result.count === 0) {
        throw conflictGstAlreadyInactive();
      }

      await recordCustomerEvent(tx, {
        customerId: registration.customerId,
        action: CUSTOMER_EVENT_ACTION.GST_DEACTIVATED,
        fromStatus: GST_STATUS.ACTIVE,
        toStatus: GST_STATUS.INACTIVE,
        remarks: data.reason,
        gstRegistrationId: id,
        actorId: actor.id,
        occurredAt: now,
      });

      return tx.customerGSTRegistration.findUniqueOrThrow({ where: { id } });
    });
  }

  // INACTIVE -> ACTIVE. It comes back as a normal registration, or as the
  // default when the customer has no active default. The GSTIN must still
  // agree with the customer's PAN (which may have changed since).
  async reactivate(
    id: string,
    actorId: string | undefined,
    data: ReactivateCustomerGstDto,
  ) {
    const actor = await requireCustomerActor(this.prisma, actorId);

    return this.withRegistration(id, async (tx, registration) => {
      if (registration.isActive) {
        throw conflictGstAlreadyActive();
      }

      const customer = await tx.customer.findUniqueOrThrow({
        where: { id: registration.customerId },
        select: { panNumber: true },
      });

      if (!gstinMatchesPan(registration.gstin, customer.panNumber)) {
        throw badRequestPanMismatch(registration.gstin, customer.panNumber!);
      }

      const currentDefault = await tx.customerGSTRegistration.findFirst({
        where: {
          customerId: registration.customerId,
          isActive: true,
          isDefault: true,
        },
        select: { id: true },
      });

      const becomesDefault = !currentDefault;
      const now = new Date();

      const result = await tx.customerGSTRegistration.updateMany({
        where: { id, isActive: false },
        data: { isActive: true, isDefault: becomesDefault },
      });

      if (result.count === 0) {
        throw conflictGstAlreadyActive();
      }

      await recordCustomerEvent(tx, {
        customerId: registration.customerId,
        action: CUSTOMER_EVENT_ACTION.GST_REACTIVATED,
        fromStatus: GST_STATUS.INACTIVE,
        toStatus: GST_STATUS.ACTIVE,
        remarks: data.remarks,
        gstRegistrationId: id,
        actorId: actor.id,
        occurredAt: now,
      });

      if (becomesDefault) {
        await this.recordDefaultChange(
          tx,
          registration.customerId,
          id,
          null,
          registration.gstin,
          actor.id,
          now,
        );
      }

      return tx.customerGSTRegistration.findUniqueOrThrow({ where: { id } });
    });
  }

  // Makes an active registration the customer's default. Already the default:
  // nothing changes and nothing is recorded.
  async setDefault(id: string, actorId: string | undefined) {
    const actor = await requireCustomerActor(this.prisma, actorId);

    return this.withRegistration(id, async (tx, registration) => {
      if (!registration.isActive) {
        throw conflictGstInactive(
          'This GST registration is inactive. Reactivate it before making it the default.',
        );
      }

      if (registration.isDefault) {
        return registration;
      }

      const currentDefault = await tx.customerGSTRegistration.findFirst({
        where: {
          customerId: registration.customerId,
          isActive: true,
          isDefault: true,
        },
        select: { id: true, gstin: true },
      });

      // Unset before setting: the database allows one active default.
      if (currentDefault) {
        await tx.customerGSTRegistration.updateMany({
          where: { id: currentDefault.id, isDefault: true },
          data: { isDefault: false },
        });
      }

      const now = new Date();

      const result = await tx.customerGSTRegistration.updateMany({
        where: { id, isActive: true, isDefault: false },
        data: { isDefault: true },
      });

      if (result.count === 0) {
        throw conflictGstInactive(
          'This GST registration changed while it was being made the default. Reload and try again.',
        );
      }

      await this.recordDefaultChange(
        tx,
        registration.customerId,
        id,
        currentDefault?.gstin ?? null,
        registration.gstin,
        actor.id,
        now,
      );

      return tx.customerGSTRegistration.findUniqueOrThrow({ where: { id } });
    });
  }

  // Runs a change to one registration while holding its customer's row lock, so
  // every change to a customer's registrations is made one at a time and the
  // registration is read after the lock is taken. The customer must be active.
  private async withRegistration<T>(
    id: string,
    action: (
      tx: Tx,
      registration: Prisma.CustomerGSTRegistrationGetPayload<object>,
    ) => Promise<T>,
  ): Promise<T> {
    const owner = await this.prisma.customerGSTRegistration.findUnique({
      where: { id },
      select: { customerId: true },
    });

    if (!owner) {
      throw notFoundGst();
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await lockCustomer(tx, owner.customerId);

      if (!locked.isActive) {
        throw conflictCustomerInactive(GST_CUSTOMER_INACTIVE_MESSAGE);
      }

      const registration = await tx.customerGSTRegistration.findUnique({
        where: { id },
      });

      if (!registration) {
        throw notFoundGst();
      }

      return action(tx, registration);
    });
  }

  private recordDefaultChange(
    tx: Tx,
    customerId: string,
    registrationId: string,
    fromGstin: string | null,
    toGstin: string,
    actorId: string,
    occurredAt: Date,
  ) {
    return recordCustomerEvent(tx, {
      customerId,
      action: CUSTOMER_EVENT_ACTION.GST_DEFAULT_CHANGED,
      changes: { defaultGstin: { from: fromGstin, to: toGstin } },
      gstRegistrationId: registrationId,
      actorId,
      occurredAt,
    });
  }

  private toExisting(
    row: Prisma.CustomerGSTRegistrationGetPayload<{
      select: typeof EXISTING_SELECT;
    }>,
  ) {
    return {
      id: row.id,
      gstin: row.gstin,
      customerId: row.customerId,
      customerCode: row.customer.customerCode,
      customerName: row.customer.customerName,
    };
  }
}

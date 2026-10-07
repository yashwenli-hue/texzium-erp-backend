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
  conflictDuplicatePan,
  findCustomerMatches,
  isUniqueViolation,
  lockCustomer,
  lockCustomerName,
  matchReasons,
  recordCustomerEvent,
  requireCustomer,
  requireCustomerActor,
  takeCustomerCodeNumber,
  CustomerMatch,
} from './customer-lifecycle';
import {
  CUSTOMER_EDITABLE_FIELDS,
  CustomerEditableField,
  diffCustomerFields,
  formatCustomerCode,
  normalizeEmail,
  normalizePan,
} from './customer-values';

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

        throw error;
      }
    }
  }

  private createOnce(data: CreateCustomerDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockCustomerName(tx, data.customerName);

      assertNoBlockingDuplicate(
        await findCustomerMatches(tx, {
          name: data.customerName,
          pan: data.panNumber ?? null,
          phone: null,
          email: null,
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

      return customer;
    });
  }

  async findAll() {
    return this.prisma.customer.findMany({
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
      include: { actor: { select: CUSTOMER_ACTOR_SELECT } },
    });
  }

  // Customers that look like the one described, for a form to warn before it
  // saves. PAN and name matches are what create/edit refuse; phone and email
  // only warn. Nothing is written.
  async duplicateCheck(query: CustomerDuplicateCheckQueryDto) {
    const { customerName, panNumber, phone, email } = query;

    if (!customerName && !panNumber && !phone && !email) {
      throw new BadRequestException(
        'Give at least one of customerName, panNumber, phone or email.',
      );
    }

    const matches = await findCustomerMatches(this.prisma, {
      name: customerName ?? null,
      pan: panNumber ? normalizePan(panNumber) : null,
      phone: phone ?? null,
      email: email ? normalizeEmail(email) : null,
      excludeId: query.excludeCustomerId ?? null,
    });

    const present = (m: CustomerMatch) => ({
      id: m.id,
      customerCode: m.customerCode,
      customerName: m.customerName,
      isActive: m.isActive,
      reasons: matchReasons(m),
    });

    return {
      blocking: matches.filter((m) => m.panMatch || m.nameMatch).map(present),
      warnings: matches.filter((m) => !m.panMatch && !m.nameMatch).map(present),
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

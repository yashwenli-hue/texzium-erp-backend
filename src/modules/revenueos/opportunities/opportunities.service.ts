import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { UpdateOpportunityStageDto } from './dto/update-opportunity-stage.dto';
import {
  INITIAL_OPPORTUNITY_STAGE,
  assertOpportunityStageTransition,
  opportunityStageConflictMessage,
  opportunityStageLabel,
} from './opportunity-stage';
import { LEAD_HISTORY_INCLUDE } from '../leads/lead-history.include';
import { lockActiveLeadForWrite } from '../leads/lead-lifecycle';
import { LinkOpportunityCustomerDto } from './dto/link-opportunity-customer.dto';
import {
  CUSTOMER_EVENT_ACTION,
  recordCustomerEvent,
  requireActiveCustomerShared,
} from '../customer-master/customer-lifecycle';
import {
  OPPORTUNITY_CUSTOMER_ACTION,
  OPPORTUNITY_CUSTOMER_SELECT,
  OPPORTUNITY_NOT_FOUND_MESSAGE,
  conflictOpportunityCustomerChanged,
  conflictOpportunityCustomerLocked,
  conflictOpportunityGstOfAnotherCustomer,
  lockOpportunityForLink,
  usesRegistrationOfAnotherCustomer,
} from './opportunity-customer';

const CUSTOMER_INACTIVE_FOR_LINK =
  'This customer is inactive. Reactivate it before linking it to an opportunity.';

@Injectable()
export class OpportunitiesService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateOpportunityDto, actorId?: string) {
    if (data.customerId) {
      await this.requireActor(actorId);
    }

    return this.prisma.$transaction(async (tx) => {
      // An opportunity blocks deactivation, so it must not be created while
      // the lead is being deactivated (and vice versa).
      await lockActiveLeadForWrite(tx, data.leadId);

      // A customer given at creation must be active, and stays so until this
      // commits.
      if (data.customerId) {
        await requireActiveCustomerShared(
          tx,
          data.customerId,
          CUSTOMER_INACTIVE_FOR_LINK,
        );
      }

      const now = new Date();

      const opportunity = await tx.opportunity.create({
        data: {
          leadId: data.leadId,
          customerId: data.customerId,
          title: data.title,
          expectedValue: data.expectedValue,
          probability: data.probability,
          expectedCloseDate: new Date(data.expectedCloseDate),
          status: INITIAL_OPPORTUNITY_STAGE,
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: data.leadId,
          action: 'OPPORTUNITY_CREATED',
          remarks: `Opportunity created: ${data.title}`,
          ...(data.customerId ? { actorId, occurredAt: now } : {}),
        },
      });

      if (data.customerId) {
        await recordCustomerEvent(tx, {
          customerId: data.customerId,
          action: CUSTOMER_EVENT_ACTION.OPPORTUNITY_LINKED,
          opportunityId: opportunity.id,
          remarks: data.title,
          actorId: actorId!,
          occurredAt: now,
        });
      }

      if (!data.customerId) {
        return { ...opportunity, customer: null };
      }

      return tx.opportunity.findUniqueOrThrow({
        where: { id: opportunity.id },
        include: { customer: { select: OPPORTUNITY_CUSTOMER_SELECT } },
      });
    });
  }

  // Links the opportunity to a customer, changes its customer, or (with null)
  // removes it. Only while the opportunity has no quotation: every document
  // under it takes its customer from here. The customer must be active, and so
  // must the lead. The opportunity row is locked, so the link and a quotation
  // being created cannot both succeed; the update only matches the customer the
  // caller saw. Linking again to the same customer changes nothing and records
  // nothing.
  async linkCustomer(
    id: string,
    actorId: string | undefined,
    body: LinkOpportunityCustomerDto,
  ) {
    await this.requireActor(actorId);

    const toCustomerId = body.customerId;

    return this.prisma.$transaction(async (tx) => {
      const opportunity = await tx.opportunity.findUnique({
        where: { id },
        select: { leadId: true, title: true },
      });

      if (!opportunity) {
        throw new NotFoundException(OPPORTUNITY_NOT_FOUND_MESSAGE);
      }

      await lockActiveLeadForWrite(tx, opportunity.leadId);

      const { customerId: fromCustomerId } = await lockOpportunityForLink(
        tx,
        id,
      );

      if (fromCustomerId === toCustomerId) {
        return tx.opportunity.findUniqueOrThrow({
          where: { id },
          include: { customer: { select: OPPORTUNITY_CUSTOMER_SELECT } },
        });
      }

      // An opportunity that has a customer and a quotation keeps its customer.
      // One that has no customer yet can be given one whatever it already has
      // (see opportunity-customer.ts), provided nothing under it uses another
      // customer's registration.
      if (
        fromCustomerId &&
        (await tx.quotation.count({ where: { opportunityId: id } })) > 0
      ) {
        throw conflictOpportunityCustomerLocked();
      }

      if (
        toCustomerId &&
        (await usesRegistrationOfAnotherCustomer(tx, id, toCustomerId))
      ) {
        throw conflictOpportunityGstOfAnotherCustomer();
      }

      if (toCustomerId) {
        await requireActiveCustomerShared(
          tx,
          toCustomerId,
          CUSTOMER_INACTIVE_FOR_LINK,
        );
      }

      const describe = async (customerId: string) => {
        const c = await tx.customer.findUniqueOrThrow({
          where: { id: customerId },
          select: { customerCode: true, customerName: true },
        });

        return `${c.customerName} (${c.customerCode})`;
      };

      const fromLabel = fromCustomerId ? await describe(fromCustomerId) : null;
      const toLabel = toCustomerId ? await describe(toCustomerId) : null;

      const moved = await tx.opportunity.updateMany({
        where: { id, customerId: fromCustomerId },
        data: { customerId: toCustomerId },
      });

      if (moved.count === 0) {
        throw conflictOpportunityCustomerChanged();
      }

      const now = new Date();

      const [action, remarks] = !fromLabel
        ? [
            OPPORTUNITY_CUSTOMER_ACTION.LINKED,
            `Opportunity "${opportunity.title}": customer set to ${toLabel}`,
          ]
        : !toLabel
          ? [
              OPPORTUNITY_CUSTOMER_ACTION.UNLINKED,
              `Opportunity "${opportunity.title}": customer ${fromLabel} removed`,
            ]
          : [
              OPPORTUNITY_CUSTOMER_ACTION.CHANGED,
              `Opportunity "${opportunity.title}": customer ${fromLabel} → ${toLabel}`,
            ];

      await tx.leadTimeline.create({
        data: {
          leadId: opportunity.leadId,
          action,
          remarks,
          actorId,
          occurredAt: now,
        },
      });

      if (fromCustomerId) {
        await recordCustomerEvent(tx, {
          customerId: fromCustomerId,
          action: CUSTOMER_EVENT_ACTION.OPPORTUNITY_UNLINKED,
          opportunityId: id,
          remarks: opportunity.title,
          actorId: actorId!,
          occurredAt: now,
        });
      }

      if (toCustomerId) {
        await recordCustomerEvent(tx, {
          customerId: toCustomerId,
          action: CUSTOMER_EVENT_ACTION.OPPORTUNITY_LINKED,
          opportunityId: id,
          remarks: opportunity.title,
          actorId: actorId!,
          occurredAt: now,
        });
      }

      return tx.opportunity.findUniqueOrThrow({
        where: { id },
        include: { customer: { select: OPPORTUNITY_CUSTOMER_SELECT } },
      });
    });
  }

  // Moves an opportunity to another stage. The update only matches while the
  // opportunity is still in the stage the caller saw, so two people acting at
  // once cannot both succeed and a stale screen cannot overwrite a newer move.
  async updateStage(
    id: string,
    actorId: string | undefined,
    body: UpdateOpportunityStageDto,
  ) {
    await this.requireActor(actorId);

    const { fromStage, toStage } = body;
    assertOpportunityStageTransition(fromStage, toStage);

    return this.prisma.$transaction(async (tx) => {
      const opportunity = await tx.opportunity.findUnique({
        where: { id },
        select: { leadId: true, title: true },
      });

      if (!opportunity) {
        throw new NotFoundException('Opportunity not found.');
      }

      // Normal sales writes do not touch a deactivated lead. An opportunity
      // blocks deactivation, so this holds today by construction; the lock
      // keeps it true if that ever changes.
      await lockActiveLeadForWrite(tx, opportunity.leadId);

      const now = new Date();

      const result = await tx.opportunity.updateMany({
        where: { id, status: fromStage },
        data: { status: toStage },
      });

      if (result.count === 0) {
        const current = await tx.opportunity.findUnique({
          where: { id },
          select: { status: true },
        });

        if (!current) {
          throw new NotFoundException('Opportunity not found.');
        }

        throw new ConflictException(
          opportunityStageConflictMessage(current.status),
        );
      }

      // A change made by a person: SYSTEM history with the actor recorded, not
      // an employee activity.
      await tx.leadTimeline.create({
        data: {
          leadId: opportunity.leadId,
          action: 'OPPORTUNITY_STAGE_CHANGED',
          remarks: `Opportunity "${opportunity.title}": ${opportunityStageLabel(fromStage)} → ${opportunityStageLabel(toStage)}`,
          actorId,
          occurredAt: now,
        },
      });

      return tx.opportunity.findUnique({ where: { id } });
    });
  }

  async findAll() {
    return this.prisma.opportunity.findMany({
      include: {
        lead: true,
        customer: { select: OPPORTUNITY_CUSTOMER_SELECT },
      },
    });
  }

  async findOne(id: string) {
    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id },
      include: {
        customer: { select: OPPORTUNITY_CUSTOMER_SELECT },
        lead: {
          include: {
            source: true,
            assignedTo: {
              select: {
                id: true,
                fullName: true,
              },
            },
            ...LEAD_HISTORY_INCLUDE,
            followups: {
              orderBy: {
                followupDate: 'asc',
              },
            },
          },
        },
      },
    });

    if (!opportunity) {
      throw new NotFoundException('Opportunity not found.');
    }

    return opportunity;
  }

  private async requireActor(actorId: string | undefined) {
    if (!actorId) {
      throw new UnauthorizedException('Authenticated user required.');
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true },
    });

    if (!actor) {
      throw new UnauthorizedException('Authenticated user not found.');
    }
  }
}

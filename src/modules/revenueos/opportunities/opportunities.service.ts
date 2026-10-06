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

@Injectable()
export class OpportunitiesService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateOpportunityDto) {
    return this.prisma.$transaction(async (tx) => {
      // An opportunity blocks deactivation, so it must not be created while
      // the lead is being deactivated (and vice versa).
      await lockActiveLeadForWrite(tx, data.leadId);

      const opportunity = await tx.opportunity.create({
        data: {
          leadId: data.leadId,
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
        },
      });

      return opportunity;
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
      },
    });
  }

  async findOne(id: string) {
    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id },
      include: {
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

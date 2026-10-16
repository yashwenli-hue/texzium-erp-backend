import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { LeadTimelineSource } from '@prisma/client';

import { PrismaService } from '../../../core/database/prisma.service';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { lockActiveLeadForUpdate } from '../leads/lead-lifecycle';
import {
  canMoveLeadStatus,
  leadStatusLabel,
  statusMoveRefusal,
} from '../lead-assignments/lead-transitions';

// The pre-qualification moves (New, Contacted, Underqualified) of the pipeline board and
// the lead page. Qualification, rejection, reopening and assignment have their own
// governed actions and are refused here (409), so this endpoint can no longer jump a
// lead to any status. The change and its STATUS_UPDATED event are one transaction under
// the lock on the lead, and the event records who made it.
@Injectable()
export class LeadStatusService {
  constructor(private prisma: PrismaService) {}

  async update(data: UpdateLeadStatusDto, actorId: string | undefined) {
    if (!actorId) {
      throw new UnauthorizedException('Authenticated user required.');
    }

    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, data.leadId);

      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { id: true },
      });

      if (!actor) {
        throw new UnauthorizedException('Authenticated user not found.');
      }

      const current = await tx.lead.findUnique({
        where: { id: data.leadId },
        select: { status: true },
      });

      if (!current) {
        throw new NotFoundException('Lead not found.');
      }

      if (data.expectedStatus && data.expectedStatus !== current.status) {
        throw new ConflictException(
          `This lead's status has changed (it is now ${leadStatusLabel(current.status)}). Reload the lead and try again.`,
        );
      }

      if (!canMoveLeadStatus(current.status, data.status)) {
        throw new ConflictException(
          statusMoveRefusal(current.status, data.status),
        );
      }

      const lead = await tx.lead.update({
        where: { id: data.leadId },
        data: { status: data.status },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: data.leadId,
          action: 'STATUS_UPDATED',
          remarks: `Status changed from ${leadStatusLabel(current.status)} to ${leadStatusLabel(data.status)}.`,
          userRemark: data.remarks ?? null,
          source: LeadTimelineSource.SYSTEM,
          actorId: actor.id,
        },
      });

      return lead;
    });
  }
}

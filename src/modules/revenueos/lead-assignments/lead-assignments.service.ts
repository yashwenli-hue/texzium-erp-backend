import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { lockActiveLeadForUpdate } from '../leads/lead-lifecycle';

// Each change and its history event are one transaction under the lock on the
// lead, so a deactivation or deletion of the lead in progress is waited for and then
// seen (404 / 409), never raced.
@Injectable()
export class LeadAssignmentsService {
  constructor(private prisma: PrismaService) {}

  async assign(data: AssignLeadDto) {
    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, data.leadId);

      const lead = await tx.lead.update({
        where: { id: data.leadId },
        data: {
          assignedToId: data.assignedToId,
          status: 'PRE_SALES_ASSIGNED',
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: lead.id,
          action: 'PRE_SALES_ASSIGNED',
          remarks: `Assigned to pre-sales user ${data.assignedToId}`,
        },
      });

      return lead;
    });
  }

  async qualifyLead(
    leadId: string,
    salesUserId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, leadId);

      const lead = await tx.lead.update({
        where: { id: leadId },
        data: {
          assignedToId: salesUserId,
          status: 'SALES_ASSIGNED',
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: lead.id,
          action: 'LEAD_QUALIFIED',
          remarks: `Lead qualified and assigned to sales ${salesUserId}`,
        },
      });

      return lead;
    });
  }

  async rejectLead(
    leadId: string,
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, leadId);

      const lead = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: 'REJECTED',
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: lead.id,
          action: 'LEAD_REJECTED',
          remarks: reason,
        },
      });

      return lead;
    });
  }
}

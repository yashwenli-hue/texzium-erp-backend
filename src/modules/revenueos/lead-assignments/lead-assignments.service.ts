import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { assertLeadActive } from '../leads/lead-lifecycle';

@Injectable()
export class LeadAssignmentsService {
  constructor(private prisma: PrismaService) {}

  async assign(data: AssignLeadDto) {
    await assertLeadActive(this.prisma, data.leadId);

    const lead = await this.prisma.lead.update({
      where: { id: data.leadId },
      data: {
        assignedToId: data.assignedToId,
        status: 'PRE_SALES_ASSIGNED',
      },
    });

    await this.prisma.leadTimeline.create({
      data: {
        leadId: lead.id,
        action: 'PRE_SALES_ASSIGNED',
        remarks: `Assigned to pre-sales user ${data.assignedToId}`,
      },
    });

    return lead;
  }

  async qualifyLead(
    leadId: string,
    salesUserId: string,
  ) {
    await assertLeadActive(this.prisma, leadId);

    const lead = await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        assignedToId: salesUserId,
        status: 'SALES_ASSIGNED',
      },
    });

    await this.prisma.leadTimeline.create({
      data: {
        leadId: lead.id,
        action: 'LEAD_QUALIFIED',
        remarks: `Lead qualified and assigned to sales ${salesUserId}`,
      },
    });

    return lead;
  }

  async rejectLead(
    leadId: string,
    reason: string,
  ) {
    await assertLeadActive(this.prisma, leadId);

    const lead = await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        status: 'REJECTED',
      },
    });

    await this.prisma.leadTimeline.create({
      data: {
        leadId: lead.id,
        action: 'LEAD_REJECTED',
        remarks: reason,
      },
    });

    return lead;
  }
}

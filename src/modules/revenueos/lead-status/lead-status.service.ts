import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { lockActiveLeadForUpdate } from '../leads/lead-lifecycle';

@Injectable()
export class LeadStatusService {
  constructor(private prisma: PrismaService) {}

  async update(data: UpdateLeadStatusDto) {
    // The lock makes the status change and its history event wait for a
    // deactivation or deletion of the lead in progress, then see its result.
    return this.prisma.$transaction(async (tx) => {
      await lockActiveLeadForUpdate(tx, data.leadId);

      const lead = await tx.lead.update({
        where: { id: data.leadId },
        data: {
          status: data.status as any,
        },
      });

      await tx.leadTimeline.create({
        data: {
          leadId: data.leadId,
          action: 'STATUS_UPDATED',
          remarks: `Status changed to ${data.status}`,
        },
      });

      return lead;
    });
  }
}

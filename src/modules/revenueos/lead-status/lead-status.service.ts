import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';

@Injectable()
export class LeadStatusService {
  constructor(private prisma: PrismaService) {}

  async update(data: UpdateLeadStatusDto) {
    const lead = await this.prisma.lead.update({
      where: { id: data.leadId },
      data: {
        status: data.status as any,
      },
    });

    await this.prisma.leadTimeline.create({
      data: {
        leadId: data.leadId,
        action: 'STATUS_UPDATED',
        remarks: `Status changed to ${data.status}`,
      },
    });

    return lead;
  }
}

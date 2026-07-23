import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class WebhooksService {
  constructor(private prisma: PrismaService) {}

  async receive(platform: string, payload: any) {
    const connector = await this.prisma.connector.findFirst({
      where: { platform },
      include: { mappings: true },
    });

    if (!connector) {
      throw new Error('Connector not found');
    }

    const transformedData: any = {};

    for (const mapping of connector.mappings) {
      transformedData[mapping.targetField] =
        payload[mapping.sourceField];
    }

    const leadSource = await this.prisma.leadSource.findFirst({
      where: {
        name: platform,
      },
    });

    const lead = await this.prisma.lead.create({
      data: {
        customerName: transformedData.customerName,
        companyName: transformedData.companyName,
        email: transformedData.email,
        phone: transformedData.phone,
        sourceId: leadSource?.id!,
      },
    });

    if (payload.requirement) {
      await this.prisma.leadNote.create({
        data: {
          leadId: lead.id,
          note: payload.requirement,
        },
      });
    }

    await this.prisma.leadTimeline.create({
      data: {
        leadId: lead.id,
        action: 'LEAD_IMPORTED',
        remarks: `${platform} lead imported`,
      },
    });

    await this.prisma.connectorLog.create({
      data: {
        connectorId: connector.id,
        action: 'WEBHOOK_PROCESSED',
        status: 'SUCCESS',
        payload,
      },
    });

    return {
      message: 'Lead imported successfully',
      lead,
    };
  }
}

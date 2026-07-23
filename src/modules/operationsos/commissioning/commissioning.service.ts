import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { NotificationService } from '../../../core/notifications/notification.service';

import { CreateCommissioningTemplateDto } from './dto/create-commissioning-template.dto';
import { CreateCommissioningFieldDto } from './dto/create-commissioning-field.dto';
import { CreateCommissioningDto } from './dto/create-commissioning.dto';
import { CreateCommissioningResultDto } from './dto/create-commissioning-result.dto';

@Injectable()
export class CommissioningService {
  constructor(
    private prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async createTemplate(data: CreateCommissioningTemplateDto) {
    return this.prisma.commissioningTemplate.create({
      data: {
        name: data.name,
      },
    });
  }

  async createField(data: CreateCommissioningFieldDto) {
    return this.prisma.commissioningTemplateField.create({
      data: {
        templateId: data.templateId,
        fieldName: data.fieldName,
        fieldType: data.fieldType,
        required: data.required ?? false,
        sequence: data.sequence,
        passCriteria: data.passCriteria,
      },
    });
  }

  async createCommissioning(data: CreateCommissioningDto) {
    return this.prisma.commissioning.create({
      data: {
        installationId: data.installationId,
        templateId: data.templateId,
        engineerName: data.engineerName,
        commissioningDate: new Date(data.commissioningDate),
        customerAccepted: data.customerAccepted ?? false,
        remarks: data.remarks,
      },
    });
  }

  async createResult(data: CreateCommissioningResultDto) {
    return this.prisma.commissioningResult.create({
      data: {
        commissioningId: data.commissioningId,
        fieldId: data.fieldId,
        fieldValue: data.fieldValue,
      },
    });
  }

  async finalizeCommissioning(id: string) {
    const commissioning = await this.prisma.commissioning.findUnique({
      where: { id },
      include: {
        results: true,
        template: {
          include: {
            fields: true,
          },
        },
      },
    });

    if (!commissioning) {
      throw new Error('Commissioning not found');
    }

    for (const result of commissioning.results) {
      const field = commissioning.template.fields.find(
        (f) => f.id === result.fieldId,
      );

      if (!field || !field.passCriteria) continue;

      if (field.fieldType === 'NUMBER') {
        const cleanCriteria = field.passCriteria.replace(/[^\d\-]/g, '');
        const [min, max] = cleanCriteria.split('-').map(Number);
        const value = Number(result.fieldValue);

        if (value < min || value > max) {
          throw new Error(
            `${field.fieldName} failed. Value ${value} outside ${field.passCriteria}`,
          );
        }
      }
    }

    await this.prisma.commissioning.update({
      where: { id },
      data: {
        finalStatus: 'COMPLETED',
      },
    });

    const installation = await this.prisma.installation.findUnique({
      where: {
        id: commissioning.installationId,
      },
      include: {
        asset: {
          include: {
            salesInvoice: {
              include: {
                salesOrder: {
                  include: {
                    inventoryItem: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!installation) {
      throw new Error('Installation not found');
    }

    const product =
      installation.asset.salesInvoice.salesOrder.inventoryItem;

    if (
      product &&
      product.warrantyApplicable &&
      product.warrantyPolicyType === 'INSTALLATION_BASED'
    ) {
      const warrantyStart = new Date();
      const warrantyEnd = new Date(warrantyStart);

      warrantyEnd.setMonth(
        warrantyEnd.getMonth() + (product.warrantyMonths ?? 0),
      );

      await this.prisma.warranty.create({
        data: {
          salesInvoiceId: installation.asset.salesInvoiceId,
          serialNumber: installation.asset.serialNumber,
          warrantyStart,
          warrantyEnd,
          status: 'ACTIVE',
          remarks:
            'Auto-created from Installation Based Commissioning Finalization',
        },
      });
    }

    await this.notificationService.createNotification({
      title: 'Commissioning Completed',
      message: `Commissioning completed for installation ${id}`,
      channel: 'IN_APP',
      category: 'COMMISSIONING',
      priority: 'HIGH',
      status: 'PENDING',
      referenceType: 'COMMISSIONING',
      referenceId: id,
    });

    return {
      message: 'Commissioning finalized successfully',
    };
  }

  async getAllCommissionings() {
    return this.prisma.commissioning.findMany({
      include: {
        installation: true,
        template: true,
        results: true,
      },
    });
  }

  async getTemplates() {
    return this.prisma.commissioningTemplate.findMany({
      include: {
        fields: {
          orderBy: {
            sequence: 'asc',
          },
        },
      },
    });
  }
}


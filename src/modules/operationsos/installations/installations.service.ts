import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateInstallationDto } from './dto/create-installation.dto';
import { WarrantyPolicyType } from '@prisma/client';

@Injectable()
export class InstallationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateInstallationDto) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: data.assetId },
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
    });

    if (!asset) {
      throw new Error('Asset not found');
    }

    const installation = await this.prisma.installation.create({
      data: {
        assetId: data.assetId,
        installationDate: new Date(data.installationDate),
        engineerName: data.engineerName,
        siteReadiness: data.siteReadiness,
        trainingCompleted: data.trainingCompleted ?? false,
        customerSignoff: data.customerSignoff ?? false,
        remarks: data.remarks,
      },
    });

    const product = asset.salesInvoice.salesOrder.inventoryItem;

    if (
      product &&
      product.warrantyApplicable &&
      product.warrantyPolicyType === WarrantyPolicyType.INSTALLATION_BASED
    ) {
      const warrantyStart = new Date(data.installationDate);
      const warrantyEnd = new Date(warrantyStart);

      warrantyEnd.setMonth(
        warrantyEnd.getMonth() + (product.warrantyMonths ?? 0),
      );

      await this.prisma.warranty.create({
        data: {
          salesInvoiceId: asset.salesInvoiceId,
          serialNumber: asset.serialNumber,
          warrantyStart,
          warrantyEnd,
          status: 'ACTIVE',
          remarks: 'Auto-created from Installation Based Warranty Policy',
        },
      });
    }

    return installation;
  }

  async findAll() {
    return this.prisma.installation.findMany({
      include: {
        asset: true,
      },
    });
  }
}

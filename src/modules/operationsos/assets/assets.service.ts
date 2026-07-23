import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateAssetDto } from './dto/create-asset.dto';

@Injectable()
export class AssetsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateAssetDto) {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id: data.salesInvoiceId },
    });

    if (!invoice) {
      throw new Error('Sales Invoice not found');
    }

    return this.prisma.asset.create({
      data: {
        serialNumber: data.serialNumber,
        salesInvoiceId: data.salesInvoiceId,
        productName: data.productName,
        installationDate: data.installationDate
          ? new Date(data.installationDate)
          : null,
        remarks: data.remarks,
      },
    });
  }

  async updateHealth(id: string, scoreChange: number) {
  const asset = await this.prisma.asset.findUnique({
    where: { id },
  });

  if (!asset) {
    throw new Error('Asset not found');
  }

  let newScore = asset.healthScore + scoreChange;

  if (newScore > 100) newScore = 100;
  if (newScore < 0) newScore = 0;

  return this.prisma.asset.update({
    where: { id },
    data: {
      healthScore: newScore,
    },
  });
}

  async findAll() {
    return this.prisma.asset.findMany({
      include: {
        salesInvoice: {
          include: {
            warranties: {
              include: {
                serviceTickets: {
                  include: {
                    engineerVisits: {
                      include: {
                        spareConsumptions: true,
                      },
                    },
                    RMA: true,
                  },
                },
                amcs: {
                  include: {
                    amcVisits: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }
}

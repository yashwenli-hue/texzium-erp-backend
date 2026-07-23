import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateConnectorDto } from './dto/create-connector.dto';
import { ConnectorType } from '@prisma/client';

@Injectable()
export class IntegrationHubService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateConnectorDto) {
    return this.prisma.connector.create({
      data: {
        ...data,
        connectorType: data.connectorType as ConnectorType,
      },
    });
  }

  async findAll() {
    return this.prisma.connector.findMany({
      include: {
        mappings: true,
        logs: true,
      },
    });
  }
}

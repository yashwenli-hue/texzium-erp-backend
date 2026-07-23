import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateConnectorMappingDto } from './dto/create-connector-mapping.dto';

@Injectable()
export class ConnectorMappingsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateConnectorMappingDto) {
    return this.prisma.connectorMapping.create({
      data,
    });
  }

  async findAll() {
    return this.prisma.connectorMapping.findMany({
      include: {
        connector: true,
      },
    });
  }
}

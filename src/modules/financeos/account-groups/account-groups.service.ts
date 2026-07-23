import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateAccountGroupDto } from './dto/create-account-group.dto';

@Injectable()
export class AccountGroupsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateAccountGroupDto) {
    return this.prisma.accountGroup.create({
      data,
    });
  }

  async findAll() {
    return this.prisma.accountGroup.findMany({
      include: {
        chartAccounts: true,
      },
    });
  }
}


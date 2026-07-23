import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateRoleDto) {
    return this.prisma.role.create({
      data,
    });
  }

  async findAll() {
    return this.prisma.role.findMany();
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { recordAdminAudit, requireActor } from '../identity-admin';
import { CreateRoleDto } from './dto/create-role.dto';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  // A new role starts with no permissions, so creating one grants nothing.
  async create(data: CreateRoleDto, actorId: string | undefined) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await requireActor(tx, actorId);

      const role = await tx.role.create({
        data: { name: data.name, description: data.description },
      });

      await recordAdminAudit(tx, {
        actorId: actor.id,
        action: 'ROLE_CREATED',
        recordId: role.id,
        newData: { name: role.name, description: role.description },
      });

      return role;
    });
  }

  async findAll() {
    return this.prisma.role.findMany();
  }
}

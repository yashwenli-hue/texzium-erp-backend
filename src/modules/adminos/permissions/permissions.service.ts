import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { recordAdminAudit, requireActor } from '../identity-admin';
import { CreatePermissionDto } from './dto/create-permission.dto';

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  // Adds a code to the catalogue; it grants nothing until it is assigned to a role.
  async create(data: CreatePermissionDto, actorId: string | undefined) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await requireActor(tx, actorId);

      const permission = await tx.permission.create({
        data: { code: data.code, name: data.name, module: data.module },
      });

      await recordAdminAudit(tx, {
        actorId: actor.id,
        action: 'PERMISSION_CREATED',
        recordId: permission.id,
        newData: {
          code: permission.code,
          name: permission.name,
          module: permission.module,
        },
      });

      return permission;
    });
  }

  async findAll() {
    return this.prisma.permission.findMany();
  }
}

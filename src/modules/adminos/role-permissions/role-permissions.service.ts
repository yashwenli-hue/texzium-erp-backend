import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  AdminCaller,
  assertHoldsAll,
  recordAdminAudit,
  requireActor,
} from '../identity-admin';
import { AssignPermissionDto } from './dto/assign-permission.dto';

@Injectable()
export class RolePermissionsService {
  constructor(private prisma: PrismaService) {}

  async assign(data: AssignPermissionDto, caller: AdminCaller | undefined) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await requireActor(tx, caller?.id);

      const permission = await tx.permission.findUnique({
        where: { id: data.permissionId },
        select: { id: true, code: true },
      });

      if (!permission) {
        throw new NotFoundException('Permission not found.');
      }

      const role = await tx.role.findUnique({
        where: { id: data.roleId },
        select: { id: true, name: true },
      });

      if (!role) {
        throw new NotFoundException('Role not found.');
      }

      assertHoldsAll(
        caller,
        [permission.code],
        `assign ${permission.code} to the role ${role.name}`,
      );

      const assignment = await tx.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });

      await recordAdminAudit(tx, {
        actorId: actor.id,
        action: 'ROLE_PERMISSION_ASSIGNED',
        recordId: assignment.id,
        newData: {
          roleId: role.id,
          roleName: role.name,
          permissionId: permission.id,
          permissionCode: permission.code,
        },
      });

      return assignment;
    });
  }

  async findAll() {
    return this.prisma.rolePermission.findMany({
      include: {
        role: true,
        permission: true,
      },
    });
  }
}

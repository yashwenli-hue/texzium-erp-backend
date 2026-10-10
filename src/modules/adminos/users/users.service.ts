import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { USER_DIRECTORY_SELECT } from '../../../core/security/user-select';
import {
  AdminCaller,
  assertHoldsAll,
  recordAdminAudit,
  requireActor,
} from '../identity-admin';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateUserDto, caller: AdminCaller | undefined) {
    const hashedPassword = await bcrypt.hash(data.password, 10);

    return this.prisma.$transaction(async (tx) => {
      const actor = await requireActor(tx, caller?.id);

      const role = await tx.role.findUnique({
        where: { id: data.roleId },
        select: {
          id: true,
          name: true,
          permissions: { select: { permission: { select: { code: true } } } },
        },
      });

      if (!role) {
        throw new NotFoundException('Role not found.');
      }

      assertHoldsAll(
        caller,
        role.permissions.map((rp) => rp.permission.code),
        `create a user with the role ${role.name}`,
      );

      const user = await tx.user.create({
        data: {
          fullName: data.fullName,
          email: data.email,
          passwordHash: hashedPassword,
          phone: data.phone,
          roleId: data.roleId,
        },
        select: USER_DIRECTORY_SELECT,
      });

      await recordAdminAudit(tx, {
        actorId: actor.id,
        action: 'USER_CREATED',
        recordId: user.id,
        newData: {
          email: user.email,
          fullName: user.fullName,
          roleId: role.id,
          roleName: role.name,
        },
      });

      return user;
    });
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: USER_DIRECTORY_SELECT,
    });
  }
}

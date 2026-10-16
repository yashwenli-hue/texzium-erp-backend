import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { USER_DIRECTORY_SELECT } from '../../../core/security/user-select';
import {
  AdminCaller,
  assertAdministrationRemains,
  assertHoldsAll,
  recordAdminAudit,
  requireActor,
} from '../identity-admin';
import { ChangeUserRoleDto } from './dto/change-user-role.dto';
import { ChangeUserStatusDto } from './dto/change-user-status.dto';
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

  // Moves a user to another role. Hold what you grant: the caller must hold every
  // permission of the new role. Nobody changes their own role (no self-escalation, no
  // accidental self-lockout), and the change is refused when it would leave nobody able
  // to administer access. The user's current login keeps its old permissions until it
  // expires (tokens last one day) or they sign in again.
  async changeRole(
    id: string,
    data: ChangeUserRoleDto,
    caller: AdminCaller | undefined,
  ) {
    if (caller?.id === id) {
      throw new BadRequestException('You cannot change your own role.');
    }

    return this.prisma.$transaction(async (tx) => {
      const actor = await requireActor(tx, caller?.id);
      const user = await tx.user.findUnique({
        where: { id },
        select: {
          id: true,
          fullName: true,
          roleId: true,
          role: { select: { name: true } },
        },
      });
      if (!user) throw new NotFoundException('User not found.');

      const role = await tx.role.findUnique({
        where: { id: data.roleId },
        select: {
          id: true,
          name: true,
          permissions: { select: { permission: { select: { code: true } } } },
        },
      });
      if (!role) throw new NotFoundException('Role not found.');
      if (user.roleId === role.id) {
        throw new ConflictException(
          `${user.fullName} already has the role ${role.name}.`,
        );
      }

      assertHoldsAll(
        caller,
        role.permissions.map((rp) => rp.permission.code),
        `give the role ${role.name}`,
      );

      const updated = await tx.user.update({
        where: { id },
        data: { roleId: role.id },
        select: USER_DIRECTORY_SELECT,
      });

      await recordAdminAudit(tx, {
        actorId: actor.id,
        action: 'USER_ROLE_CHANGED',
        recordId: id,
        newData: {
          userId: id,
          fullName: user.fullName,
          fromRoleId: user.roleId,
          fromRoleName: user.role.name,
          toRoleId: role.id,
          toRoleName: role.name,
        },
      });

      await assertAdministrationRemains(tx);
      return updated;
    });
  }

  // Activates, deactivates or suspends a user (never the caller themself). An INACTIVE or
  // SUSPENDED user cannot sign in again and cannot be given leads; their current login
  // ends when it expires (one day).
  async changeStatus(
    id: string,
    data: ChangeUserStatusDto,
    caller: AdminCaller | undefined,
  ) {
    if (caller?.id === id) {
      throw new BadRequestException('You cannot change your own status.');
    }

    return this.prisma.$transaction(async (tx) => {
      const actor = await requireActor(tx, caller?.id);
      const user = await tx.user.findUnique({
        where: { id },
        select: { id: true, fullName: true, status: true },
      });
      if (!user) throw new NotFoundException('User not found.');
      if (user.status === data.status) {
        throw new ConflictException(
          `${user.fullName} is already ${data.status.toLowerCase()}.`,
        );
      }

      const updated = await tx.user.update({
        where: { id },
        data: { status: data.status },
        select: USER_DIRECTORY_SELECT,
      });

      await recordAdminAudit(tx, {
        actorId: actor.id,
        action: 'USER_STATUS_CHANGED',
        recordId: id,
        newData: {
          userId: id,
          fullName: user.fullName,
          from: user.status,
          to: data.status,
          ...(data.reason ? { reason: data.reason } : {}),
        },
      });

      await assertAdministrationRemains(tx);
      return updated;
    });
  }
}

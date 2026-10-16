import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  AdminCaller,
  assertAdministrationRemains,
  assertHoldsAll,
  isSensitivePermission,
  recordAdminAudit,
  requireActor,
} from '../identity-admin';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';

// What a role looks like to the access screens: its permission codes and how many
// users hold it (userCount). Never any user's details.
const ROLE_SUMMARY = {
  permissions: {
    select: {
      permission: {
        select: { id: true, code: true, name: true, module: true },
      },
    },
  },
} as const;

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
    const roles = await this.prisma.role.findMany({
      include: ROLE_SUMMARY,
      orderBy: { name: 'asc' },
    });
    return this.withUserCounts(this.prisma, roles);
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: ROLE_SUMMARY,
    });
    if (!role) throw new NotFoundException('Role not found.');
    return (await this.withUserCounts(this.prisma, [role]))[0];
  }

  private async withUserCounts<T extends { id: string }>(
    db: Pick<PrismaService, 'user'>,
    roles: T[],
  ): Promise<Array<T & { userCount: number }>> {
    const counts = await db.user.groupBy({
      by: ['roleId'],
      where: { roleId: { in: roles.map((r) => r.id) } },
      _count: { _all: true },
    });
    const byRole = new Map(
      counts.map((c) => [c.roleId, c._count._all] as const),
    );
    return roles.map((r) => ({ ...r, userCount: byRole.get(r.id) ?? 0 }));
  }

  // One reviewed change: grants need roles.permissions.assign and may only hand out what
  // the caller holds; revokes need roles.permissions.revoke and may only take away what
  // the caller holds. Sensitive grants need acknowledgeSensitive. Everything is applied
  // in one transaction with one audit entry per change, and refused as a whole when it
  // would leave nobody able to administer access.
  async updatePermissions(
    roleId: string,
    data: UpdateRolePermissionsDto,
    caller: AdminCaller | undefined,
  ) {
    const grant = [...new Set(data.grant ?? [])];
    const revoke = [...new Set(data.revoke ?? [])];
    const both = grant.filter((c) => revoke.includes(c));

    if (both.length) {
      throw new BadRequestException(
        `A code cannot be granted and revoked at once: ${both.join(', ')}.`,
      );
    }
    if (!grant.length && !revoke.length) {
      throw new BadRequestException('Nothing to change: give grant or revoke.');
    }
    if (grant.length)
      assertHoldsAll(caller, ['roles.permissions.assign'], 'grant permissions');
    if (revoke.length)
      assertHoldsAll(
        caller,
        ['roles.permissions.revoke'],
        'revoke permissions',
      );
    assertHoldsAll(caller, grant, 'make this change');
    assertHoldsAll(caller, revoke, 'revoke these permissions');

    const sensitive = grant.filter(isSensitivePermission);
    if (sensitive.length && data.acknowledgeSensitive !== true) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'SENSITIVE_GRANT_NOT_ACKNOWLEDGED',
        message: `These permissions are sensitive and must be confirmed: ${sensitive.sort().join(', ')}.`,
        sensitive: sensitive.sort(),
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const actor = await requireActor(tx, caller?.id);
      // The role row is locked so two edits of the same role run one after the other.
      const locked = await tx.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT "id", "name" FROM "Role" WHERE "id" = ${roleId} FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Role not found.');
      const role = locked[0];

      const codes = [...grant, ...revoke];
      const permissions = await tx.permission.findMany({
        where: { code: { in: codes } },
        select: { id: true, code: true },
      });
      const unknown = codes.filter(
        (c) => !permissions.some((p) => p.code === c),
      );
      if (unknown.length) {
        throw new BadRequestException(
          `Unknown permission codes: ${unknown.sort().join(', ')}.`,
        );
      }
      const idOf = new Map(permissions.map((p) => [p.code, p.id] as const));

      const current = new Set(
        (
          await tx.rolePermission.findMany({
            where: { roleId },
            select: { permission: { select: { code: true } } },
          })
        ).map((rp) => rp.permission.code),
      );

      const granted: string[] = [];
      const revoked: string[] = [];

      for (const code of grant.filter((c) => !current.has(c)).sort()) {
        const rp = await tx.rolePermission.create({
          data: { roleId, permissionId: idOf.get(code)! },
        });
        await recordAdminAudit(tx, {
          actorId: actor.id,
          action: 'ROLE_PERMISSION_ASSIGNED',
          recordId: rp.id,
          newData: {
            roleId,
            roleName: role.name,
            permissionId: rp.permissionId,
            permissionCode: code,
          },
        });
        granted.push(code);
      }

      for (const code of revoke.filter((c) => current.has(c)).sort()) {
        const permissionId = idOf.get(code)!;
        const rp = await tx.rolePermission.findUniqueOrThrow({
          where: { roleId_permissionId: { roleId, permissionId } },
          select: { id: true },
        });
        await tx.rolePermission.delete({ where: { id: rp.id } });
        await recordAdminAudit(tx, {
          actorId: actor.id,
          action: 'ROLE_PERMISSION_REVOKED',
          recordId: rp.id,
          newData: {
            roleId,
            roleName: role.name,
            permissionId,
            permissionCode: code,
          },
        });
        revoked.push(code);
      }

      if (revoked.length) await assertAdministrationRemains(tx);

      const updated = await tx.role.findUniqueOrThrow({
        where: { id: roleId },
        include: ROLE_SUMMARY,
      });

      return {
        role: (await this.withUserCounts(tx, [updated]))[0],
        granted,
        revoked,
      };
    });
  }
}

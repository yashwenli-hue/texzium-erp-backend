import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Shared rules for administering users, roles and permissions.

// The signed-in user as JwtStrategy puts it on the request.
export interface AdminCaller {
  id?: string;
  permissions?: unknown;
}

export type AdminRequest = { user?: AdminCaller };

// Every administrative change is attributed to a user who still exists.
export async function requireActor(
  db: Prisma.TransactionClient,
  actorId: string | undefined,
): Promise<{ id: string }> {
  if (!actorId) {
    throw new UnauthorizedException('Authenticated user required.');
  }

  const actor = await db.user.findUnique({
    where: { id: actorId },
    select: { id: true },
  });

  if (!actor) {
    throw new UnauthorizedException('Authenticated user not found.');
  }

  return actor;
}

// Hold what you grant: nobody can hand out a permission they do not hold themselves
// (directly, by assigning it to a role, or indirectly, by creating a user in a role).
// No role is exempt: SUPER_ADMIN can grant exactly the permissions it has been granted.
export function assertHoldsAll(
  caller: AdminCaller | undefined,
  required: string[],
  action: string,
): void {
  const held = Array.isArray(caller?.permissions)
    ? (caller.permissions as unknown[])
    : [];
  const missing = [...new Set(required)].filter((code) => !held.includes(code));

  if (missing.length > 0) {
    throw new ForbiddenException(
      `You cannot ${action}: it would grant permissions you do not hold (${missing.sort().join(', ')}).`,
    );
  }
}

// An AuditLog entry, written in the same transaction as the change it records.
// newData must never contain a password or any other credential.
export async function recordAdminAudit(
  db: Prisma.TransactionClient,
  entry: {
    actorId: string;
    action:
      | 'USER_CREATED'
      | 'ROLE_CREATED'
      | 'PERMISSION_CREATED'
      | 'ROLE_PERMISSION_ASSIGNED';
    recordId: string;
    newData: Prisma.InputJsonObject;
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: entry.actorId,
      action: entry.action,
      module: 'AdminOS',
      recordId: entry.recordId,
      newData: entry.newData,
    },
  });
}

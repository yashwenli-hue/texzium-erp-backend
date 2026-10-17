import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
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
// A code that another, wider code already includes: holding the wider one counts as
// holding it for hold-what-you-grant. revenue.view.all (every RevenueOS record) includes
// finance.view.all (every financial record), so an administrator can delegate finance
// visibility without first being granted the narrower code.
export const INCLUDED_BY: Readonly<Record<string, readonly string[]>> = {
  'finance.view.all': ['revenue.view.all'],
};

export function assertHoldsAll(
  caller: AdminCaller | undefined,
  required: string[],
  action: string,
): void {
  const held = Array.isArray(caller?.permissions)
    ? (caller.permissions as unknown[])
    : [];
  const holds = (code: string) =>
    held.includes(code) ||
    (INCLUDED_BY[code] ?? []).some((wider) => held.includes(wider));
  const missing = [...new Set(required)].filter((code) => !holds(code));

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
      | 'ROLE_PERMISSION_ASSIGNED'
      | 'ROLE_PERMISSION_REVOKED'
      | 'USER_ROLE_CHANGED'
      | 'USER_STATUS_CHANGED'
      | 'WHATSAPP_CONFIG_CREATED'
      | 'WHATSAPP_CONFIG_UPDATED';
    // Defaults to AdminOS.
    module?: 'AdminOS' | 'WhatsApp';
    recordId: string;
    newData: Prisma.InputJsonObject;
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: entry.actorId,
      action: entry.action,
      module: entry.module ?? 'AdminOS',
      recordId: entry.recordId,
      newData: entry.newData,
    },
  });
}

// Permissions that open money, documents, deletion, every record or the permission
// system itself. Granting one needs an explicit acknowledgement in the request
// (acknowledgeSensitive: true), so a broad grant is never made by accident; the
// screens ask the person to confirm before they send it.
export const SENSITIVE_PERMISSIONS: readonly string[] = [
  'revenue.view.all',
  'finance.view.all',
  'payments.gateway.manage',
  'invoices.create',
  'invoices.document.view',
  'collections.record',
  'governance.deletions.view',
  'governance.deletions.restore',
  'governance.deletions.purge',
  'leads.delete',
  'customers.delete',
  'permissions.manage',
  'roles.create',
  'roles.permissions.assign',
  'roles.permissions.revoke',
  'users.create',
  'users.view',
  'users.role.assign',
  'users.status.manage',
  'whatsapp.config.view',
  'whatsapp.config.manage',
  'documents.profile.manage',
];

export const isSensitivePermission = (code: string) =>
  SENSITIVE_PERMISSIONS.includes(code);

// The permission whose loss would lock everyone out of administering access.
export const ADMIN_ANCHOR_PERMISSION = 'roles.permissions.assign';

// After a change, at least one ACTIVE user must still hold the anchor permission
// through their role; otherwise the change is refused (and, being in the same
// transaction, undone).
export async function assertAdministrationRemains(
  db: Prisma.TransactionClient,
): Promise<void> {
  const holders = await db.user.count({
    where: {
      status: 'ACTIVE',
      role: {
        permissions: {
          some: { permission: { code: ADMIN_ANCHOR_PERMISSION } },
        },
      },
    },
  });

  if (holders === 0) {
    throw new ConflictException(
      `This would leave no active user who can assign permissions (${ADMIN_ANCHOR_PERMISSION}), so nobody could administer access any more. Nothing was changed.`,
    );
  }
}

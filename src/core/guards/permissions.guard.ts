import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

// Checks the permissions a route declares with @Permissions(): the user must hold every
// one of them. Permissions declared on the controller class count as well and are
// required in addition to the handler's (before, a class-level @Permissions was silently
// ignored).
//
// A route that declares none needs no particular permission, but it is never public:
// the global JwtAuthGuard has already required a valid login token. Which routes behind
// this guard may go without a permission is fixed in route-authentication.spec.ts.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndMerge<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredPermissions.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: { permissions?: unknown } }>();
    const permissions = request.user?.permissions;

    // Only a real list counts: a string would otherwise match by substring.
    if (!Array.isArray(permissions)) {
      return false;
    }

    return requiredPermissions.every((permission) =>
      permissions.includes(permission),
    );
  }
}

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- test doubles are intentionally loosely typed */
import { Controller, ExecutionContext, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { Permissions } from '../decorators/permissions.decorator';
import { Public } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';

// Unit checks of the two guards on their own. The whole application (every route,
// through real HTTP) is covered by route-authentication.spec.ts.

@Controller('plain')
class PlainController {
  @Get()
  open() {}

  @Public()
  @Get('public')
  publicRoute() {}

  @Permissions('a.view')
  @Get('needs-a')
  needsA() {}

  @Permissions('a.view', 'b.view')
  @Get('needs-a-b')
  needsAB() {}
}

// A controller-wide @Public() must not open anything.
@Public()
@Controller('class-public')
class ClassPublicController {
  @Get()
  route() {}
}

// Class-level permissions are required in addition to the handler's.
@Permissions('c.view')
@Controller('class-perm')
class ClassPermController {
  @Get()
  classOnly() {}

  @Permissions('a.view')
  @Get('both')
  both() {}
}

function context(
  cls: new (...args: any[]) => any,
  handler: string,
  user?: unknown,
): ExecutionContext {
  const request = { user, headers: {} };

  return {
    getHandler: () => cls.prototype[handler],
    getClass: () => cls,
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
    getArgs: () => [request, {}],
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const reflector = new Reflector();
  let passport: jest.SpyInstance;

  beforeEach(() => {
    // Stand-in for the passport check: we only test what the guard decides before it.
    passport = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockReturnValue('PASSPORT' as any);
  });

  afterEach(() => passport.mockRestore());

  it('lets a handler marked @Public() through without checking a token', () => {
    const guard = new JwtAuthGuard(reflector);

    expect(guard.canActivate(context(PlainController, 'publicRoute'))).toBe(
      true,
    );
    expect(passport).not.toHaveBeenCalled();
  });

  it('requires the token check for every other handler', () => {
    const guard = new JwtAuthGuard(reflector);

    expect(guard.canActivate(context(PlainController, 'open'))).toBe(
      'PASSPORT',
    );
    expect(passport).toHaveBeenCalledTimes(1);
  });

  it('ignores @Public() on a controller class', () => {
    const guard = new JwtAuthGuard(reflector);

    expect(guard.canActivate(context(ClassPublicController, 'route'))).toBe(
      'PASSPORT',
    );
    expect(passport).toHaveBeenCalledTimes(1);
  });
});

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());
  const user = (permissions: unknown) => ({ id: 'u1', permissions });

  it('allows a route that declares no permission (the login is checked by JwtAuthGuard)', () => {
    expect(guard.canActivate(context(PlainController, 'open', user([])))).toBe(
      true,
    );
  });

  it('allows a user holding the declared permission', () => {
    expect(
      guard.canActivate(context(PlainController, 'needsA', user(['a.view']))),
    ).toBe(true);
  });

  it('refuses a user missing the declared permission', () => {
    expect(
      guard.canActivate(context(PlainController, 'needsA', user(['b.view']))),
    ).toBe(false);
  });

  it('requires every declared permission', () => {
    expect(
      guard.canActivate(context(PlainController, 'needsAB', user(['a.view']))),
    ).toBe(false);
    expect(
      guard.canActivate(
        context(PlainController, 'needsAB', user(['a.view', 'b.view'])),
      ),
    ).toBe(true);
  });

  it('refuses when there is no user or no permission list', () => {
    expect(guard.canActivate(context(PlainController, 'needsA'))).toBe(false);
    expect(
      guard.canActivate(context(PlainController, 'needsA', { id: 'u1' })),
    ).toBe(false);
  });

  it('does not match a permission inside a string instead of a list', () => {
    expect(
      guard.canActivate(
        context(PlainController, 'needsA', user('a.view,b.view')),
      ),
    ).toBe(false);
    expect(
      guard.canActivate(context(PlainController, 'needsA', user('xa.viewx'))),
    ).toBe(false);
  });

  it('enforces permissions declared on the controller class', () => {
    expect(
      guard.canActivate(context(ClassPermController, 'classOnly', user([]))),
    ).toBe(false);
    expect(
      guard.canActivate(
        context(ClassPermController, 'classOnly', user(['c.view'])),
      ),
    ).toBe(true);
  });

  it('requires class and handler permissions together', () => {
    expect(
      guard.canActivate(context(ClassPermController, 'both', user(['a.view']))),
    ).toBe(false);
    expect(
      guard.canActivate(context(ClassPermController, 'both', user(['c.view']))),
    ).toBe(false);
    expect(
      guard.canActivate(
        context(ClassPermController, 'both', user(['a.view', 'c.view'])),
      ),
    ).toBe(true);
  });
});

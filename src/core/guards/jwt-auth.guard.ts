import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// Requires a valid, unexpired login token. Registered globally (APP_GUARD in AuthModule),
// so every route is protected unless its handler is marked @Public(); controllers that
// also list it in @UseGuards simply run the same check again.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // The handler only: a controller-wide @Public() is not honoured.
    if (this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getHandler())) {
      return true;
    }

    return super.canActivate(context);
  }
}

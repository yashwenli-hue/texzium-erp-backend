import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from '../database/prisma.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CredentialRedactionInterceptor } from '../security/credential-redaction.interceptor';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'texzium-secret',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PrismaService,
    JwtStrategy,
    // Default deny: every route of the application needs a valid login token unless
    // its handler is marked @Public() (see core/decorators/public.decorator.ts).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // No response ever carries a password hash, at any depth (safety net behind the
    // explicit safe user selects in core/security/user-select.ts).
    { provide: APP_INTERCEPTOR, useClass: CredentialRedactionInterceptor },
  ],
})
export class AuthModule {}

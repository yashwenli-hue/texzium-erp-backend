import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import { AuthModule } from './auth.module';
import { JwtStrategy } from './jwt.strategy';
import { JWT_SECRET_MISSING_MESSAGE, requireJwtSecret } from './jwt-secret';
import { PrismaService } from '../database/prisma.service';

describe('the login-token secret', () => {
  it('is the configured JWT_SECRET, trimmed', () => {
    expect(requireJwtSecret({ JWT_SECRET: '  s3cret-value \n' })).toBe(
      's3cret-value',
    );
  });

  it.each([
    ['missing', {}],
    ['empty', { JWT_SECRET: '' }],
    ['only spaces', { JWT_SECRET: '   ' }],
  ])('%s -> refuses, naming JWT_SECRET (no built-in fallback)', (_, env) => {
    expect(() => requireJwtSecret(env)).toThrow(JWT_SECRET_MISSING_MESSAGE);
  });

  describe('the auth module', () => {
    const saved = process.env.JWT_SECRET;
    afterEach(() => {
      if (saved === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = saved;
    });

    const build = () =>
      Test.createTestingModule({ imports: [AuthModule] })
        .overrideProvider(PrismaService)
        .useValue({})
        .compile();

    it('signs with JWT_SECRET, and the token strategy checks with the same value', async () => {
      process.env.JWT_SECRET = 'module-test-secret';
      const moduleRef = await build();
      const jwt = moduleRef.get(JwtService);
      const token = await jwt.signAsync({ sub: 'u1' });
      expect(
        jwt.verify<{ sub: string }>(token, { secret: 'module-test-secret' })
          .sub,
      ).toBe('u1');
      // the old built-in fallbacks no longer verify anything
      expect(() => {
        jwt.verify(token, { secret: 'texzium-secret' });
      }).toThrow();
      expect(moduleRef.get(JwtStrategy)).toBeDefined();
    });

    it('does not start without JWT_SECRET', async () => {
      delete process.env.JWT_SECRET;
      await expect(build()).rejects.toThrow(JWT_SECRET_MISSING_MESSAGE);
    });
  });
});

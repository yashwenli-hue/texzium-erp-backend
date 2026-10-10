import { CallHandler, ExecutionContext, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lastValueFrom, of } from 'rxjs';

import {
  CredentialRedactionInterceptor,
  redactCredentials,
} from './credential-redaction.interceptor';

describe('redactCredentials', () => {
  it('removes passwordHash from a user', () => {
    expect(
      redactCredentials({ id: 'u1', fullName: 'A', passwordHash: '$2b$10$x' }),
    ).toEqual({ id: 'u1', fullName: 'A' });
  });

  it('removes it at any depth, inside arrays and nested records', () => {
    const value = {
      leads: [
        { id: 'l1', assignedTo: { id: 'u1', passwordHash: 'h1' } },
        { id: 'l2', assignedTo: null },
        {
          id: 'l3',
          opportunities: [
            { owner: { user: { passwordHash: 'h2', id: 'u2' } } },
          ],
        },
      ],
    };

    expect(redactCredentials(value)).toEqual({
      leads: [
        { id: 'l1', assignedTo: { id: 'u1' } },
        { id: 'l2', assignedTo: null },
        { id: 'l3', opportunities: [{ owner: { user: { id: 'u2' } } }] },
      ],
    });
    // The original is not modified.
    expect(value.leads[0].assignedTo).toHaveProperty('passwordHash', 'h1');
  });

  it('returns the very same value when there is nothing to remove', () => {
    const value = { a: [{ b: 1 }], c: 'x' };

    expect(redactCredentials(value)).toBe(value);
  });

  it('leaves non-plain values untouched', () => {
    const date = new Date('2026-10-10T00:00:00Z');
    const decimal = new Prisma.Decimal('12.50');
    const buffer = Buffer.from('pdf');
    const out = redactCredentials({ date, decimal, buffer, passwordHash: 'h' });

    expect(out).toEqual({ date, decimal, buffer });
    expect(out.date).toBe(date);
    expect(out.decimal).toBe(decimal);
    expect(out.buffer).toBe(buffer);
  });

  it('passes primitives, null and undefined through', () => {
    expect(redactCredentials(null)).toBeNull();
    expect(redactCredentials(undefined)).toBeUndefined();
    expect(redactCredentials('text')).toBe('text');
    expect(redactCredentials(7)).toBe(7);
  });

  it('keeps other fields that merely look similar', () => {
    expect(
      redactCredentials({ password_policy: 'strong', hashCode: 3 }),
    ).toEqual({ password_policy: 'strong', hashCode: 3 });
  });
});

describe('CredentialRedactionInterceptor', () => {
  const interceptor = new CredentialRedactionInterceptor();
  const run = (value: unknown) =>
    lastValueFrom(
      interceptor.intercept(
        {} as ExecutionContext,
        {
          handle: () => of(value),
        } as CallHandler,
      ),
    );

  it('redacts what a handler returns', async () => {
    await expect(
      run([{ id: 'u1', passwordHash: 'h', role: { id: 'r1' } }]),
    ).resolves.toEqual([{ id: 'u1', role: { id: 'r1' } }]);
  });

  it('passes a file stream through unchanged', async () => {
    const file = new StreamableFile(Buffer.from('pdf'));

    await expect(run(file)).resolves.toBe(file);
  });
});

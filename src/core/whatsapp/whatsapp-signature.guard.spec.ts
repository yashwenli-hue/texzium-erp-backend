import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'crypto';

import {
  checkMetaSignature,
  WhatsAppSignatureGuard,
} from './whatsapp-signature.guard';

const SECRET = 'unit-test-app-secret';
// Deliberately not in JSON.stringify form: the signature covers the exact bytes.
const RAW = Buffer.from(
  '{ "entry" : [ ] ,\n "object":"whatsapp_business_account" }',
);
const sign = (body: Buffer | string, key = SECRET) =>
  `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;

describe('checkMetaSignature', () => {
  it('accepts the signature of the exact raw body', () => {
    expect(checkMetaSignature(SECRET, RAW, sign(RAW))).toBe('OK');
    expect(
      checkMetaSignature(
        SECRET,
        RAW,
        sign(RAW).toUpperCase().replace('SHA256=', 'sha256='),
      ),
    ).toBe('OK');
  });

  it('is not configured without a secret, whatever the request carries', () => {
    expect(checkMetaSignature(undefined, RAW, sign(RAW))).toBe(
      'NOT_CONFIGURED',
    );
    expect(checkMetaSignature('', RAW, sign(RAW))).toBe('NOT_CONFIGURED');
  });

  it('reports a missing signature', () => {
    expect(checkMetaSignature(SECRET, RAW, undefined)).toBe('MISSING');
    expect(checkMetaSignature(SECRET, RAW, '')).toBe('MISSING');
    expect(checkMetaSignature(SECRET, RAW, ['a', 'b'])).toBe('MISSING');
  });

  it('rejects a signature made with another key', () => {
    expect(checkMetaSignature(SECRET, RAW, sign(RAW, 'other-key'))).toBe(
      'INVALID',
    );
  });

  it('rejects a tampered body, even one that parses to the same JSON', () => {
    const reformatted = Buffer.from(JSON.stringify(JSON.parse(RAW.toString())));
    expect(checkMetaSignature(SECRET, reformatted, sign(RAW))).toBe('INVALID');
    expect(checkMetaSignature(SECRET, Buffer.from('{}'), sign(RAW))).toBe(
      'INVALID',
    );
  });

  it('rejects malformed headers and a missing raw body', () => {
    for (const header of [
      'sha1=abc',
      'sha256=',
      'sha256=xyz',
      sign(RAW).slice(0, -2),
      `${sign(RAW)}00`,
      sign(RAW).replace('sha256=', ''),
    ]) {
      expect(checkMetaSignature(SECRET, RAW, header)).toBe('INVALID');
    }
    expect(checkMetaSignature(SECRET, undefined, sign(RAW))).toBe('INVALID');
  });
});

describe('WhatsAppSignatureGuard', () => {
  const guard = new WhatsAppSignatureGuard();
  const ctx = (headers: Record<string, string>, rawBody?: Buffer) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers, rawBody }) }),
    }) as unknown as ExecutionContext;
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.WHATSAPP_APP_SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = saved;
  });

  it('fails closed with 503 when no secret is configured', () => {
    delete process.env.WHATSAPP_APP_SECRET;
    expect(() =>
      guard.canActivate(ctx({ 'x-hub-signature-256': sign(RAW) }, RAW)),
    ).toThrow(ServiceUnavailableException);
  });

  it('refuses a missing or invalid signature with 401', () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    expect(() => guard.canActivate(ctx({}, RAW))).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      guard.canActivate(ctx({ 'x-hub-signature-256': sign(RAW, 'x') }, RAW)),
    ).toThrow(UnauthorizedException);
  });

  it('lets a correctly signed delivery through', () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    expect(
      guard.canActivate(ctx({ 'x-hub-signature-256': sign(RAW) }, RAW)),
    ).toBe(true);
  });
});

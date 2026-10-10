import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

// Meta signs every webhook delivery: header X-Hub-Signature-256: sha256=<hex>, an
// HMAC-SHA256 of the exact raw request body keyed with the app secret. The secret is
// read from the environment (WHATSAPP_APP_SECRET) and never stored in the database.

export type SignatureCheck = 'OK' | 'NOT_CONFIGURED' | 'MISSING' | 'INVALID';

export function checkMetaSignature(
  secret: string | undefined,
  rawBody: Buffer | undefined,
  header: string | string[] | undefined,
): SignatureCheck {
  if (!secret) return 'NOT_CONFIGURED';
  if (typeof header !== 'string' || header.length === 0) return 'MISSING';
  if (!rawBody) return 'INVALID';

  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return 'INVALID';

  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(match[1], 'hex');

  return received.length === expected.length &&
    timingSafeEqual(received, expected)
    ? 'OK'
    : 'INVALID';
}

// Fails closed: without a configured secret no delivery is accepted.
@Injectable()
export class WhatsAppSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      rawBody?: Buffer;
      headers: Record<string, string | string[] | undefined>;
    }>();

    const result = checkMetaSignature(
      process.env.WHATSAPP_APP_SECRET,
      request.rawBody,
      request.headers['x-hub-signature-256'],
    );

    if (result === 'NOT_CONFIGURED') {
      throw new ServiceUnavailableException(
        'The WhatsApp webhook is not configured.',
      );
    }

    if (result !== 'OK') {
      throw new UnauthorizedException('Invalid webhook signature.');
    }

    return true;
  }
}

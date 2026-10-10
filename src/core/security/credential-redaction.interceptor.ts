import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';

// Credential fields that must never leave the server, at any depth of a response.
export const CREDENTIAL_FIELDS: ReadonlySet<string> = new Set(['passwordHash']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;

  return proto === Object.prototype || proto === null;
}

// Returns the value without any credential field. Only plain objects and arrays are
// walked (what Prisma returns); anything else (Date, Decimal, Buffer, a file stream) is
// passed through untouched. Nothing is copied unless something has to be removed.
export function redactCredentials<T>(value: T): T {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item: unknown) => {
      const next = redactCredentials(item);
      if (next !== item) changed = true;
      return next;
    });

    return (changed ? out : value) as T;
  }

  if (!isPlainObject(value)) return value;

  let changed = false;
  const out: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    if (CREDENTIAL_FIELDS.has(key)) {
      changed = true;
      continue;
    }

    const next = redactCredentials(item);
    if (next !== item) changed = true;
    out[key] = next;
  }

  return (changed ? out : value) as T;
}

// Registered globally (APP_INTERCEPTOR in AuthModule). A safety net: services must still
// select only safe user fields (core/security/user-select.ts).
@Injectable()
export class CredentialRedactionInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(map((data: unknown) => redactCredentials(data)));
  }
}

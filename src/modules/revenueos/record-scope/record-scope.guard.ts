import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PrismaService } from '../../../core/database/prisma.service';
import { assertVisible, scopeOf, ScopedKind } from './record-scope';

export const SCOPED_RECORDS_KEY = 'revenueos:scoped-records';

export type ScopedRecordSpec = {
  kind: ScopedKind;
  from: 'params' | 'body' | 'query';
  field: string;
};

/**
 * The record this route reads or changes must be visible to the caller (record-scope.ts),
 * or the request is answered 404 before the handler runs. `source` is where its id is:
 * 'params.id', 'body.leadId', 'query.salesOrderId', ... A missing or non-string value is
 * left to validation. Several decorators may be stacked.
 */
export const ScopedRecord = (kind: ScopedKind, source: string) => {
  const [from, field] = source.split('.') as [ScopedRecordSpec['from'], string];
  return (
    target: object,
    key?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    const holder: object = descriptor ? (descriptor.value as object) : target;
    const existing =
      (Reflect.getMetadata(SCOPED_RECORDS_KEY, holder) as
        | ScopedRecordSpec[]
        | undefined) ?? [];
    // Decorators run bottom-up: prepend, so the checks run in the order they are written.
    SetMetadata(SCOPED_RECORDS_KEY, [{ kind, from, field }, ...existing])(
      target,
      key as string,
      descriptor as PropertyDescriptor,
    );
  };
};

@Injectable()
export class RecordScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const specs = this.reflector.get<ScopedRecordSpec[] | undefined>(
      SCOPED_RECORDS_KEY,
      context.getHandler(),
    );
    if (!specs?.length) return true;
    const req = context.switchToHttp().getRequest<{
      user?: { id?: string; permissions?: unknown };
      params?: Record<string, unknown>;
      body?: Record<string, unknown>;
      query?: Record<string, unknown>;
    }>();
    const scope = scopeOf(req.user);
    if (scope.all) return true;
    for (const spec of specs) {
      const value = req[spec.from]?.[spec.field];
      if (typeof value !== 'string' || value === '') continue;
      await assertVisible(this.prisma, scope, spec.kind, value);
    }
    return true;
  }
}

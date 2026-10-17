import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { FINANCE_VIEW_PERMISSION, hasFinanceVisibility } from './record-scope';

// Company-wide financial data - receivables, ledgers, vouchers, write-offs, the finance,
// collections and executive dashboards, GST returns and e-invoices - is not split by
// record: it is either seen whole or not at all. These routes had only the login check;
// they now need finance visibility (`finance.view.all`, or `revenue.view.all` which
// includes it), so a salesperson, pre-sales or HR login cannot read company totals or
// another salesperson's customers through them. The global login check still runs first.

@Injectable()
export class FinanceVisibilityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { id?: string; permissions?: unknown } }>();
    if (!req.user?.id)
      throw new UnauthorizedException('Authenticated user required.');
    if (!hasFinanceVisibility(req.user))
      throw new ForbiddenException(
        `This is company-wide financial data: it needs finance visibility (${FINANCE_VIEW_PERMISSION}).`,
      );
    return true;
  }
}

/** On a controller or route: only people with finance visibility. */
export const FinanceRecords = () => UseGuards(FinanceVisibilityGuard);

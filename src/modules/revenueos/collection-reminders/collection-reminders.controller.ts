import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { FinanceVisibilityGuard } from '../record-scope/finance-visibility.guard';
import { CollectionRemindersService } from './collection-reminders.service';

// Every overdue invoice of every customer: only for people with finance visibility
// (finance.view.all, or revenue.view.all which includes it).
@Controller('collection-reminders')
@UseGuards(JwtAuthGuard, FinanceVisibilityGuard)
export class CollectionRemindersController {
  constructor(
    private readonly collectionRemindersService: CollectionRemindersService,
  ) {}

  @Get('check-due')
  checkDue() {
    return this.collectionRemindersService.checkDue();
  }
}

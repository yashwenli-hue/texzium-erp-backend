import { Controller, Get } from '@nestjs/common';
import { CollectionRemindersService } from './collection-reminders.service';

@Controller('collection-reminders')
export class CollectionRemindersController {
  constructor(
    private readonly collectionRemindersService: CollectionRemindersService,
  ) {}

  @Get('check-due')
  checkDue() {
    return this.collectionRemindersService.checkDue();
  }
}

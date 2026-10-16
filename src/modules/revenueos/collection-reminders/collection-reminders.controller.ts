import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { VIEW_ALL_PERMISSION } from '../record-scope/record-scope';
import { CollectionRemindersService } from './collection-reminders.service';

// Every overdue invoice of every customer: only for people who may see every record.
@Controller('collection-reminders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(VIEW_ALL_PERMISSION)
export class CollectionRemindersController {
  constructor(
    private readonly collectionRemindersService: CollectionRemindersService,
  ) {}

  @Get('check-due')
  checkDue() {
    return this.collectionRemindersService.checkDue();
  }
}

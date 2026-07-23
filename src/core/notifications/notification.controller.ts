import {
  Body,
  Controller,
  Get,
  Patch,
  Param,
  Post,
} from '@nestjs/common';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
  ) {}

  @Post()
  create(@Body() body: any) {
    return this.notificationService.createNotification(body);
  }

  @Get()
  getAll() {
    return this.notificationService.getNotifications();
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string) {
    return this.notificationService.markAsRead(id);
  }

  @Patch(':id/delivered')
  markDelivered(@Param('id') id: string) {
    return this.notificationService.markDelivered(id);
  }
}

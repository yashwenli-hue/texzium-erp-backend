import { Module } from '@nestjs/common';
import { CollectionRemindersController } from './collection-reminders.controller';
import { CollectionRemindersService } from './collection-reminders.service';

@Module({
  controllers: [CollectionRemindersController],
  providers: [CollectionRemindersService],
})
export class CollectionRemindersModule {}

import { Module } from '@nestjs/common';
import { JournalEngineController } from './journal-engine.controller';
import { JournalEngineService } from './journal-engine.service';

@Module({
  controllers: [JournalEngineController],
  providers: [JournalEngineService],
})
export class JournalEngineModule {}

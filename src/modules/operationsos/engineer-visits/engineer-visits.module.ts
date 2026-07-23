import { Module } from '@nestjs/common';
import { EngineerVisitsController } from './engineer-visits.controller';
import { EngineerVisitsService } from './engineer-visits.service';

@Module({
  controllers: [EngineerVisitsController],
  providers: [EngineerVisitsService],
})
export class EngineerVisitsModule {}

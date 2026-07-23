import { Module } from '@nestjs/common';
import { AmcVisitsController } from './amc-visits.controller';
import { AmcVisitsService } from './amc-visits.service';

@Module({
  controllers: [AmcVisitsController],
  providers: [AmcVisitsService],
})
export class AmcVisitsModule {}

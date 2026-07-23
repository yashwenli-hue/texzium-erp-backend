import { Module } from '@nestjs/common';
import { BadDebtWriteOffController } from './bad-debt-writeoff.controller';
import { BadDebtWriteOffService } from './bad-debt-writeoff.service';

@Module({
  controllers: [BadDebtWriteOffController],
  providers: [BadDebtWriteOffService],
})
export class BadDebtWriteOffModule {}

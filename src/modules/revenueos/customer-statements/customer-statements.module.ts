import { Module } from '@nestjs/common';
import { CustomerStatementsController } from './customer-statements.controller';
import { CustomerStatementsService } from './customer-statements.service';

@Module({
  controllers: [CustomerStatementsController],
  providers: [CustomerStatementsService],
})
export class CustomerStatementsModule {}

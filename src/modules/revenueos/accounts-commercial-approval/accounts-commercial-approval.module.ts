import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../core/database/database.module';
import { AccountsCommercialApprovalController } from './accounts-commercial-approval.controller';
import { AccountsCommercialApprovalService } from './accounts-commercial-approval.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AccountsCommercialApprovalController],
  providers: [AccountsCommercialApprovalService],
})
export class AccountsCommercialApprovalModule {}

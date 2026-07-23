import { Module } from '@nestjs/common';
import { CommissioningController } from './commissioning.controller';
import { CommissioningService } from './commissioning.service';
import { CommissioningCertificateService } from './commissioning-certificate.service';
import { DocumentModule } from '../../documentos/document.module';
import { EmailModule } from '../../../core/email/email.module';
import { NotificationModule } from '../../../core/notifications/notification.module';

@Module({
  imports: [
    DocumentModule,
    EmailModule,
    NotificationModule,
  ],
  controllers: [CommissioningController],
  providers: [
    CommissioningService,
    CommissioningCertificateService,
  ],
})
export class CommissioningModule {}

import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { CommunicationModule } from '../../modules/adminos/communication/communication.module';
import { PrismaService } from '../database/prisma.service';


@Module({
  imports: [CommunicationModule],
  controllers: [EmailController],
  providers: [EmailService, PrismaService],
  exports: [EmailService],
})
export class EmailModule {}

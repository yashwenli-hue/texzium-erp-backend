import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { CommunicationService } from '../../modules/adminos/communication/communication.service';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class EmailService {
  constructor(
    private readonly communicationService: CommunicationService,
    private readonly prisma: PrismaService,
  ) {}

  async sendDynamicMail(
    smtpConfigId: string,
    department: string,
    to: string,
    subject: string,
    text: string,
    attachments?: any[],
    referenceType?: string,
    referenceId?: string,
  ) {
    const smtpConfig =
      await this.communicationService.getSMTPConfig(smtpConfigId);

    if (!smtpConfig) {
      throw new Error('SMTP Config not found');
    }

    const departmentEmail =
      await this.communicationService.getDepartmentEmail(
        smtpConfigId,
        department,
      );

    const senderEmail =
      departmentEmail?.email ?? smtpConfig.defaultSender;

    const transporter = nodemailer.createTransport({
      host: smtpConfig.smtpHost,
      port: smtpConfig.smtpPort,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.smtpUser,
        pass: smtpConfig.smtpPass,
      },
    });

    console.log('====================================');
    console.log(
      'SERVER MAIL SEND TIME:',
      new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
      }),
    );
    console.log('SMTP USER:', smtpConfig.smtpUser);
    console.log('DEPARTMENT:', department);
    console.log('FROM:', `"${department}" <${smtpConfig.smtpUser}>`);
    console.log('TO:', to);
    console.log('SUBJECT:', subject);
    console.log('====================================');

    try {
      const result = await transporter.sendMail({
        from: `"${department}" <${smtpConfig.smtpUser}>`,
        to,
        subject,
        text,
        attachments,
      });

      await this.prisma.emailLog.create({
        data: {
          smtpConfigId,
          department,
          senderEmail,
          recipientEmail: to,
          subject,
          body: text,
          status: 'SENT',
          referenceType,
          referenceId,
        },
      });

      console.log('MAIL RESPONSE:', result.response);
      console.log('MESSAGE ID:', result.messageId);
      console.log('ACCEPTED:', result.accepted);
      console.log('REJECTED:', result.rejected);
      console.log('====================================');

      return result;
    } catch (error) {
      await this.prisma.emailLog.create({
        data: {
          smtpConfigId,
          department,
          senderEmail,
          recipientEmail: to,
          subject,
          body: text,
          status: 'FAILED',
          errorMessage: error.message,
          referenceType,
          referenceId,
        },
      });

      throw error;
    }
  }
  async getLogs() {
  return this.prisma.emailLog.findMany({
    orderBy: {
      createdAt: 'desc',
    },
  });
}

}

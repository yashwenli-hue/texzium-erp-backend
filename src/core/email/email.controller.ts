import { Body, Controller, Post, Get } from '@nestjs/common';
import { EmailService } from './email.service';

@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('test')
  async testEmail(
    @Body()
    body: {
      smtpConfigId: string;
      department: string;
      to: string;
      subject: string;
      text: string;
    },
  ) {
    return this.emailService.sendDynamicMail(
      body.smtpConfigId,
      body.department,
      body.to,
      body.subject,
      body.text,
    );
  }

  @Get('logs')
  getLogs() {
    return this.emailService.getLogs();
  }
}

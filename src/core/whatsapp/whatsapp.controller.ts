import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsAppController {
  constructor(
    private readonly whatsappService: WhatsAppService,
  ) {}

  @Post('config')
  createConfig(@Body() body: any) {
    return this.whatsappService.createConfig(body);
  }

  @Post('bot-config')
  createBotConfig(@Body() body: any) {
    return this.whatsappService.createBotConfig(body);
  }

  @Post('department-route')
  createDepartmentRoute(@Body() body: any) {
    return this.whatsappService.createDepartmentRoute(body);
  }

  @Post('send')
  send(@Body() body: any) {
    return this.whatsappService.sendMessage(
      body.configId,
      body.to,
      body.message,
    );
  }

  @Get('configs')
  getConfigs() {
    return this.whatsappService.getConfigs();
  }

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.whatsappService.verifyWebhook(
      mode,
      token,
      challenge,
    );
  }

  @Post('webhook')
  receiveWebhook(@Body() body: any) {
    return this.whatsappService.handleIncomingMessage(body);
  }
}

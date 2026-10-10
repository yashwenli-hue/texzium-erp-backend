import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { Public } from '../decorators/public.decorator';
import { Permissions } from '../decorators/permissions.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { WhatsAppSignatureGuard } from './whatsapp-signature.guard';
import {
  CreateWhatsAppConfigDto,
  UpdateWhatsAppConfigDto,
} from './dto/whatsapp-config.dto';
import {
  CreateWhatsAppBotConfigDto,
  CreateWhatsAppDepartmentRouteDto,
  SendWhatsAppMessageDto,
} from './dto/whatsapp-bot.dto';

type AuthenticatedRequest = { user?: { id?: string } };

// Configuration and sending need explicit permissions. Responses never carry the access
// token or the webhook verify token (see whatsapp-config.view.ts).
@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  @Post('config')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.config.manage')
  createConfig(
    @Body() body: CreateWhatsAppConfigDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.whatsappService.createConfig(body, req.user?.id);
  }

  @Patch('configs/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.config.manage')
  updateConfig(
    @Param('id') id: string,
    @Body() body: UpdateWhatsAppConfigDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.whatsappService.updateConfig(id, body, req.user?.id);
  }

  @Post('bot-config')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.config.manage')
  createBotConfig(@Body() body: CreateWhatsAppBotConfigDto) {
    return this.whatsappService.createBotConfig(body);
  }

  @Post('department-route')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.config.manage')
  createDepartmentRoute(@Body() body: CreateWhatsAppDepartmentRouteDto) {
    return this.whatsappService.createDepartmentRoute(body);
  }

  @Post('send')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.messages.send')
  send(@Body() body: SendWhatsAppMessageDto) {
    return this.whatsappService.sendMessage(body);
  }

  @Get('configs')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.config.view')
  getConfigs() {
    return this.whatsappService.getConfigs();
  }

  // Meta's subscription handshake. Login-only for now (the global guard): it has to
  // become public, deliberately, before Meta can reach it.
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.whatsappService.verifyWebhook(mode, token, challenge);
  }

  // Public: incoming messages are delivered by the WhatsApp Cloud API, which cannot hold
  // a login token. Every delivery must carry Meta's signature (WhatsAppSignatureGuard).
  @Public()
  @UseGuards(WhatsAppSignatureGuard)
  @Post('webhook')
  receiveWebhook(@Body() body: any) {
    return this.whatsappService.handleIncomingMessage(body);
  }
}

import { Body, Controller, Param, Post } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post(':platform')
  receive(
    @Param('platform') platform: string,
    @Body() body: any,
  ) {
    return this.webhooksService.receive(platform, body);
  }
}

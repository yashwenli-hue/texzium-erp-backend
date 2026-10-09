import { Body, Controller, Param, Post } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { Public } from '../../../core/decorators/public.decorator';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  // Public: called by an external lead platform, which cannot hold a login token. The
  // payload is only accepted for a platform that has a configured Connector.
  @Public()
  @Post(':platform')
  receive(
    @Param('platform') platform: string,
    @Body() body: any,
  ) {
    return this.webhooksService.receive(platform, body);
  }
}

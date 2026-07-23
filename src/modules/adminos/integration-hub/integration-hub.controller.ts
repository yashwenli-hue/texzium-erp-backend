import { Body, Controller, Get, Post } from '@nestjs/common';
import { IntegrationHubService } from './integration-hub.service';
import { CreateConnectorDto } from './dto/create-connector.dto';

@Controller('connectors')
export class IntegrationHubController {
  constructor(private readonly integrationHubService: IntegrationHubService) {}

  @Post()
  create(@Body() body: CreateConnectorDto) {
    return this.integrationHubService.create(body);
  }

  @Get()
  findAll() {
    return this.integrationHubService.findAll();
  }
}

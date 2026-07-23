import { Body, Controller, Get, Post } from '@nestjs/common';
import { ConnectorMappingsService } from './connector-mappings.service';
import { CreateConnectorMappingDto } from './dto/create-connector-mapping.dto';

@Controller('connector-mappings')
export class ConnectorMappingsController {
  constructor(private readonly connectorMappingsService: ConnectorMappingsService) {}

  @Post()
  create(@Body() body: CreateConnectorMappingDto) {
    return this.connectorMappingsService.create(body);
  }

  @Get()
  findAll() {
    return this.connectorMappingsService.findAll();
  }
}

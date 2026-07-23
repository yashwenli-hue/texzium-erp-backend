import { Module } from '@nestjs/common';
import { ConnectorMappingsController } from './connector-mappings.controller';
import { ConnectorMappingsService } from './connector-mappings.service';

@Module({
  controllers: [ConnectorMappingsController],
  providers: [ConnectorMappingsService],
})
export class ConnectorMappingsModule {}

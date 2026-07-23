import { Module } from '@nestjs/common';
import { GstEngineController } from './gst-engine.controller';
import { GstEngineService } from './gst-engine.service';

@Module({
  controllers: [GstEngineController],
  providers: [GstEngineService],
})
export class GstEngineModule {}

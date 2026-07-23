import { Module } from '@nestjs/common';
import { GstReturnsController } from './gst-returns.controller';
import { GstReturnsService } from './gst-returns.service';

@Module({
  controllers: [GstReturnsController],
  providers: [GstReturnsService],
})
export class GstReturnsModule {}

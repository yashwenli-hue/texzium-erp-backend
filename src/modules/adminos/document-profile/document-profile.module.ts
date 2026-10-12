import { Module } from '@nestjs/common';

import { DocumentProfileController } from './document-profile.controller';
import { DocumentProfileService } from './document-profile.service';

@Module({
  controllers: [DocumentProfileController],
  providers: [DocumentProfileService],
})
export class DocumentProfileModule {}

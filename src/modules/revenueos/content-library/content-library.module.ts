import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../../core/database/database.module';
import { ContentFilesController } from './content-files.controller';
import { ContentLibraryController } from './content-library.controller';
import { ContentLibraryService } from './content-library.service';
import { ContentStorage } from './content-storage';
import { ContentSharesController } from './content-shares.controller';
import { ContentSharesService } from './content-shares.service';

@Module({
  imports: [DatabaseModule],
  controllers: [
    ContentLibraryController,
    ContentFilesController,
    ContentSharesController,
  ],
  providers: [ContentLibraryService, ContentStorage, ContentSharesService],
  exports: [ContentLibraryService, ContentStorage],
})
export class ContentLibraryModule {}

import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../../core/database/database.module';
import { ContentFilesController } from './content-files.controller';
import { ContentLibraryController } from './content-library.controller';
import { ContentLibraryService } from './content-library.service';
import { ContentStorage } from './content-storage';
import { ContentSharesController } from './content-shares.controller';
import { ContentSharesService } from './content-shares.service';
import { ContentUploadsController } from './content-uploads.controller';
import { ContentUploadsService } from './content-uploads.service';

@Module({
  imports: [DatabaseModule],
  controllers: [
    ContentLibraryController,
    ContentFilesController,
    ContentSharesController,
    ContentUploadsController,
  ],
  providers: [
    ContentLibraryService,
    ContentStorage,
    ContentSharesService,
    ContentUploadsService,
  ],
  exports: [ContentLibraryService, ContentStorage],
})
export class ContentLibraryModule {}

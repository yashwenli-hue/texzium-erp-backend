import { randomUUID } from 'crypto';
import { mkdirSync, promises as fs } from 'fs';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { Observable, catchError, throwError } from 'rxjs';

import { contentTmpDir } from './content-storage';
import { CONTENT_MAX_UPLOAD_BYTES } from './content-types';

// Multipart upload of one file, streamed to <content root>/tmp under a random name
// (the client's name is never part of a path). The upload is cut off just past the
// largest size any kind allows (413); the per-type limit is checked after the type is
// known. Login and permission guards run before any byte is written.
export const CONTENT_UPLOAD_OPTIONS: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, done) => {
      const dir = contentTmpDir();
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        done(null, dir);
      } catch (error) {
        done(error as Error, dir);
      }
    },
    filename: (_req, _file, done) => done(null, `${randomUUID()}.upload`),
  }),
  limits: {
    fileSize: CONTENT_MAX_UPLOAD_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 4096,
    parts: 12,
  },
};

// Removes the uploaded temporary file whenever the request fails before the service
// took it over (for example when the form fields are refused by the ValidationPipe).
@Injectable()
export class ContentUploadCleanup implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<{ file?: { path?: string } }>();
    return next.handle().pipe(
      catchError((error: unknown) => {
        const file = req.file?.path;
        if (file) void fs.unlink(file).catch(() => undefined);
        return throwError(() => error);
      }),
    );
  }
}

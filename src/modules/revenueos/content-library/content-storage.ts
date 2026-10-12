import { createHash, randomUUID } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import {
  Injectable,
  Logger,
  OnModuleInit,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

import {
  CONTENT_SNIFF_BYTES,
  CONTENT_TYPES,
  ContentKind,
  ContentTypeInfo,
  KIND_ACCEPTS,
  KIND_LABEL,
  nameExtension,
  sniffContentType,
} from './content-types';
import {
  ContentFormatError,
  StrippedImage,
  stripJpeg,
  stripMp4File,
  stripPng,
  stripWebp,
} from './content-metadata';

// Where content files live: CONTENT_STORAGE_DIR, or /root/texzium-content. Outside the
// repository and the backend's uploads/, never served statically. Layout:
//   <root>/files/<2 hex>/<uuid>.<ext>   stored versions, named by the server
//   <root>/tmp/                         uploads in progress (same file system, so a
//                                       finished upload is moved in with a rename)
// Directories are 0700 and files 0600: only the service user can read them.
export const DEFAULT_CONTENT_ROOT = '/root/texzium-content';
export const contentRoot = () =>
  path.resolve(process.env.CONTENT_STORAGE_DIR || DEFAULT_CONTENT_ROOT);
export const contentTmpDir = () => path.join(contentRoot(), 'tmp');

const STORAGE_KEY = /^[0-9a-f]{2}\/[0-9a-f-]{36}\.(pdf|jpg|png|webp|mp4)$/;
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

export type StoredContent = {
  storageKey: string;
  mimeType: ContentTypeInfo['mimeType'];
  extension: string;
  sizeBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  metadataRemoved: string[];
};

const MB = 1024 * 1024;
const megabytes = (bytes: number) => `${Math.round(bytes / MB)} MB`;

@Injectable()
export class ContentStorage implements OnModuleInit {
  private readonly logger = new Logger(ContentStorage.name);

  root() {
    return contentRoot();
  }

  // The absolute path of a stored file. Only keys of the server's own form are
  // accepted, and the result must lie inside <root>/files.
  pathOf(storageKey: string): string {
    if (!STORAGE_KEY.test(storageKey))
      throw new Error('Not a content storage key.');
    const files = path.join(this.root(), 'files');
    const full = path.resolve(files, storageKey);
    if (!full.startsWith(files + path.sep))
      throw new Error('Not a content storage key.');
    return full;
  }

  async onModuleInit() {
    // uploads abandoned mid-way (a dropped connection) are cleared after a day
    const tmp = contentTmpDir();
    const names = await fs.readdir(tmp).catch(() => [] as string[]);
    const now = Date.now();
    for (const name of names) {
      const file = path.join(tmp, name);
      const stat = await fs.stat(file).catch(() => null);
      if (stat?.isFile() && now - stat.mtimeMs > STALE_UPLOAD_MS) {
        await fs.unlink(file).catch(() => undefined);
      }
    }
  }

  // Checks an uploaded temporary file and moves it into storage. The temporary file is
  // always gone afterwards. Throws 415 (type not accepted, or not what the kind or the
  // file name says), 413 (too large for its type) or 422 (a damaged file).
  async ingest(
    tempPath: string,
    originalName: string,
    kind: ContentKind,
  ): Promise<StoredContent> {
    const work: string[] = [tempPath];
    try {
      const size = (await fs.stat(tempPath)).size;
      const type = sniffContentType(await this.head(tempPath));
      if (!type) {
        throw new UnsupportedMediaTypeException(
          'This file type is not accepted. Upload a PDF, a JPEG, PNG or WebP image, or an MP4 video.',
        );
      }
      if (type.kind !== kind) {
        throw new UnsupportedMediaTypeException(
          `This file is ${articleFor(type.label)} ${type.label}, but a ${KIND_LABEL[kind]} must be ${KIND_ACCEPTS[kind]}.`,
        );
      }
      if (!type.nameExtensions.includes(nameExtension(originalName))) {
        throw new UnsupportedMediaTypeException(
          `The file name does not match its content (${articleFor(type.label)} ${type.label}): it must end in .${type.nameExtensions.join(' or .')}.`,
        );
      }
      if (size > type.maxBytes) {
        throw new PayloadTooLargeException(
          `${type.label} files can be at most ${megabytes(type.maxBytes)}; this one is ${megabytes(size)}.`,
        );
      }

      // remove location metadata
      let source = tempPath;
      let width: number | null = null;
      let height: number | null = null;
      let removed: string[] = [];
      try {
        if (type.mimeType === 'video/mp4') {
          removed = await stripMp4File(tempPath);
        } else if (type.mimeType !== 'application/pdf') {
          const input = await fs.readFile(tempPath);
          const stripped: StrippedImage =
            type.mimeType === 'image/jpeg'
              ? stripJpeg(input)
              : type.mimeType === 'image/png'
                ? stripPng(input)
                : stripWebp(input);
          source = `${tempPath}.clean`;
          work.push(source);
          await fs.writeFile(source, stripped.data, { mode: 0o600 });
          ({ width, height, removed } = stripped);
        }
      } catch (error) {
        if (error instanceof ContentFormatError) {
          throw new UnprocessableEntityException(
            `This ${type.label} file is damaged or not a valid ${type.label} file.`,
          );
        }
        throw error;
      }

      const sha256 = await this.hash(source);
      const finalSize = (await fs.stat(source)).size;
      const id = randomUUID();
      const storageKey = `${id.slice(0, 2)}/${id}.${type.extension}`;
      const target = this.pathOf(storageKey);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.chmod(source, 0o600);
      await fs.rename(source, target);

      return {
        storageKey,
        mimeType: type.mimeType,
        extension: type.extension,
        sizeBytes: finalSize,
        sha256,
        width,
        height,
        metadataRemoved: removed,
      };
    } finally {
      for (const file of work) await fs.unlink(file).catch(() => undefined);
    }
  }

  // Removes a stored file (when the database write that would have recorded it failed).
  async discard(storageKey: string) {
    await fs.unlink(this.pathOf(storageKey)).catch((error: unknown) => {
      this.logger.warn(
        `Could not remove unrecorded content file ${storageKey}: ${String(error)}`,
      );
    });
  }

  async sizeOf(storageKey: string): Promise<number | null> {
    const stat = await fs.stat(this.pathOf(storageKey)).catch(() => null);
    return stat?.isFile() ? stat.size : null;
  }

  stream(storageKey: string, range?: { start: number; end: number }) {
    return createReadStream(this.pathOf(storageKey), range ?? {});
  }

  private async head(file: string) {
    const handle = await fs.open(file, 'r');
    try {
      const buf = Buffer.alloc(CONTENT_SNIFF_BYTES);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  private hash(file: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      createReadStream(file)
        .on('data', (chunk) => hash.update(chunk))
        .on('error', reject)
        .on('end', () => resolve(hash.digest('hex')));
    });
  }
}

function articleFor(label: string) {
  return /^[AEIMOU]/.test(label) ? 'an' : 'a';
}

export { CONTENT_TYPES };

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';

import { contentTmpDir } from './content-storage';
import {
  CONTENT_MAX_UPLOAD_BYTES,
  CONTENT_TYPES,
  displayName,
  nameExtension,
} from './content-types';

// Uploading a large file in pieces. A single request carrying a whole video can outlast
// the HTTP servers' request timeout (Node closes any request not fully received within
// 300 s, in the Next.js server the browser talks to and in this backend) on a slow
// uplink: 116 MB at 2.3 Mbit/s takes about 7 minutes. Each piece here is at most 4 MB,
// so every request finishes in seconds and no server timeout is raised.
//
// A session belongs to the user who started it and lives in <content root>/tmp as
// <id>.upload (the bytes so far) and <id>.session.json (its state). Pieces are appended
// strictly in order, at the offset the session expects; a piece is written only once
// it has been received whole, so an interrupted piece is simply sent again. The
// finished file is handed to the same ingest as any upload (type from the bytes, kind,
// name, size limits, location stripping). Sessions idle for an hour, and any other
// temporary upload file idle for an hour (an interrupted single-request upload), are
// removed every 15 minutes and at start-up.

export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
// An over-long piece is read (and discarded) up to this many bytes before it is refused
// with 413, so the answer reaches the client through the Next proxy (a backend that
// closes while the proxy is still sending makes the proxy answer 500 instead). Beyond
// it, or when the piece announces more, the connection is closed at once.
export const UPLOAD_DRAIN_BYTES = 2 * UPLOAD_CHUNK_BYTES;
export const UPLOAD_IDLE_MS = 60 * 60 * 1000;
export const UPLOAD_SWEEP_MS = 15 * 60 * 1000;
export const MAX_OPEN_UPLOADS_PER_USER = 3;
export const UPLOAD_NOT_FOUND = 'Upload not found. Start the upload again.';

type Session = {
  id: string;
  userId: string;
  fileName: string;
  sizeBytes: number;
  received: number;
  createdAt: string;
  updatedAt: string;
};

const ID = /^[0-9a-f-]{36}$/;
const ACCEPTED_EXTENSIONS = new Set(
  Object.values(CONTENT_TYPES).flatMap((t) => [...t.nameExtensions]),
);

@Injectable()
export class ContentUploadsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContentUploadsService.name);
  private readonly locks = new Map<string, Promise<unknown>>();
  private sweeper?: ReturnType<typeof setInterval>;

  async onModuleInit() {
    await this.sweep();
    this.sweeper = setInterval(() => void this.sweep(), UPLOAD_SWEEP_MS);
    this.sweeper.unref();
  }

  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  async start(userId: string | undefined, fileName: string, sizeBytes: number) {
    if (!userId) throw new BadRequestException('Sign in again to upload.');
    const name = displayName(fileName);
    if (!ACCEPTED_EXTENSIONS.has(nameExtension(name))) {
      throw new UnsupportedMediaTypeException(
        'This file type is not accepted. Upload a PDF, a JPEG, PNG or WebP image, or an MP4 video.',
      );
    }
    if (sizeBytes > CONTENT_MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `Files can be at most ${CONTENT_MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
      );
    }
    const open = (await this.sessions()).filter((s) => s.userId === userId);
    if (open.length >= MAX_OPEN_UPLOADS_PER_USER) {
      throw new HttpException(
        `You already have ${open.length} uploads in progress. Finish or cancel one first.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      userId,
      fileName: name,
      sizeBytes,
      received: 0,
      createdAt: now,
      updatedAt: now,
    };
    await fs.mkdir(contentTmpDir(), { recursive: true, mode: 0o700 });
    await fs.writeFile(this.dataPath(session.id), Buffer.alloc(0), {
      mode: 0o600,
      flag: 'wx',
    });
    await this.save(session);
    return {
      id: session.id,
      chunkBytes: UPLOAD_CHUNK_BYTES,
      sizeBytes,
      received: 0,
    };
  }

  // Appends one piece at `offset`. 409 (with the offset expected) when it is not the
  // next piece, so the client can resume from there.
  async appendChunk(
    id: string,
    userId: string | undefined,
    offset: number,
    req: Request,
  ) {
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim();
    if (type !== 'application/octet-stream') {
      throw new UnsupportedMediaTypeException(
        'Send the piece as application/octet-stream.',
      );
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > UPLOAD_DRAIN_BYTES) {
      req.destroy();
      throw new PayloadTooLargeException(
        `A piece can be at most ${UPLOAD_CHUNK_BYTES} bytes.`,
      );
    }
    const body = await readBody(req, UPLOAD_CHUNK_BYTES, UPLOAD_DRAIN_BYTES);
    if (body.length === 0) throw new BadRequestException('The piece is empty.');

    return this.locked(id, async () => {
      const session = await this.load(id, userId);
      if (offset !== session.received) {
        throw new ConflictException({
          message: `The upload continues at byte ${session.received}.`,
          received: session.received,
        });
      }
      if (session.received + body.length > session.sizeBytes) {
        throw new BadRequestException(
          'The pieces are larger than the file that was announced.',
        );
      }
      const handle = await fs.open(this.dataPath(id), 'r+');
      try {
        await handle.write(body, 0, body.length, session.received);
      } finally {
        await handle.close();
      }
      session.received += body.length;
      session.updatedAt = new Date().toISOString();
      await this.save(session);
      return { id, received: session.received, sizeBytes: session.sizeBytes };
    });
  }

  // The finished file, for the ingest (which consumes and removes it).
  async take(id: string, userId: string | undefined) {
    return this.locked(id, async () => {
      const session = await this.load(id, userId);
      const onDisk = (await fs.stat(this.dataPath(id)).catch(() => null))?.size;
      if (
        session.received !== session.sizeBytes ||
        onDisk !== session.sizeBytes
      ) {
        throw new ConflictException(
          `The upload is not complete (${session.received} of ${session.sizeBytes} bytes).`,
        );
      }
      await fs.unlink(this.sessionPath(id));
      return { path: this.dataPath(id), originalname: session.fileName };
    });
  }

  async cancel(id: string, userId: string | undefined) {
    return this.locked(id, async () => {
      await this.load(id, userId);
      await this.remove(id);
      return { id, cancelled: true };
    });
  }

  // Removes idle sessions and idle temporary upload files.
  async sweep(now = Date.now()) {
    const dir = contentTmpDir();
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    let removed = 0;
    for (const name of names) {
      const file = path.join(dir, name);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile() || now - stat.mtimeMs <= UPLOAD_IDLE_MS) continue;
      // a session's data file and state file go together: both must be idle
      const pair = /^([0-9a-f-]{36})\.(upload|session\.json)$/.exec(name);
      if (pair) {
        const sibling =
          pair[2] === 'upload'
            ? `${pair[1]}.session.json`
            : `${pair[1]}.upload`;
        const siblingStat = await fs
          .stat(path.join(dir, sibling))
          .catch(() => null);
        if (siblingStat && now - siblingStat.mtimeMs <= UPLOAD_IDLE_MS)
          continue;
      }
      await fs.unlink(file).catch(() => undefined);
      removed++;
    }
    if (removed)
      this.logger.log(`Removed ${removed} idle temporary upload file(s).`);
    return removed;
  }

  private dataPath(id: string) {
    if (!ID.test(id)) throw new NotFoundException(UPLOAD_NOT_FOUND);
    return path.join(contentTmpDir(), `${id}.upload`);
  }

  private sessionPath(id: string) {
    if (!ID.test(id)) throw new NotFoundException(UPLOAD_NOT_FOUND);
    return path.join(contentTmpDir(), `${id}.session.json`);
  }

  private async load(id: string, userId: string | undefined): Promise<Session> {
    const raw = await fs
      .readFile(this.sessionPath(id), 'utf8')
      .catch(() => null);
    const session = raw ? (JSON.parse(raw) as Session) : null;
    // another user's upload is not found, not forbidden: its existence is not revealed
    if (!session || !userId || session.userId !== userId) {
      throw new NotFoundException(UPLOAD_NOT_FOUND);
    }
    return session;
  }

  private async save(session: Session) {
    const target = this.sessionPath(session.id);
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(session), { mode: 0o600 });
    await fs.rename(temp, target);
  }

  private async remove(id: string) {
    await fs.unlink(this.dataPath(id)).catch(() => undefined);
    await fs.unlink(this.sessionPath(id)).catch(() => undefined);
  }

  private async sessions(): Promise<Session[]> {
    const names = await fs.readdir(contentTmpDir()).catch(() => [] as string[]);
    const out: Session[] = [];
    for (const name of names.filter((n) => n.endsWith('.session.json'))) {
      const raw = await fs
        .readFile(path.join(contentTmpDir(), name), 'utf8')
        .catch(() => null);
      if (raw) out.push(JSON.parse(raw) as Session);
    }
    return out;
  }

  // One operation at a time per session (pieces of one upload never interleave).
  private async locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }
}

// The request body. Past `limit` bytes it is refused (413): the rest is read and
// discarded up to `drainLimit` (so the answer can be delivered), and past that the
// connection is closed.
export function readBody(
  req: Request,
  limit: number,
  drainLimit = limit,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const tooLarge = () =>
      new PayloadTooLargeException(`A piece can be at most ${limit} bytes.`);
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > drainLimit) {
        fail(tooLarge());
        req.destroy();
        return;
      }
      if (size <= limit) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > limit) return fail(tooLarge());
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('aborted', () =>
      fail(new BadRequestException('The piece was interrupted.')),
    );
    req.on('error', (error) => fail(error));
  });
}

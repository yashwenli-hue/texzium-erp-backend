/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return -- request doubles are intentionally loosely typed */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';

import {
  ContentUploadsService,
  MAX_OPEN_UPLOADS_PER_USER,
  UPLOAD_CHUNK_BYTES,
  UPLOAD_DRAIN_BYTES,
  UPLOAD_IDLE_MS,
} from './content-uploads.service';

// A request carrying `body` as application/octet-stream (or another type).
const piece = (
  body: Buffer,
  type = 'application/octet-stream',
  declared?: number,
) => {
  const req = Readable.from(body.length ? [body] : []) as unknown as Request;
  (req as any).headers = {
    'content-type': type,
    'content-length': String(declared ?? body.length),
  };
  return req;
};

describe('content uploads in pieces', () => {
  let root: string;
  let saved: string | undefined;
  let uploads: ContentUploadsService;
  const tmp = () => path.join(root, 'tmp');

  beforeEach(async () => {
    saved = process.env.CONTENT_STORAGE_DIR;
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-uploads-'));
    process.env.CONTENT_STORAGE_DIR = root;
    uploads = new ContentUploadsService();
  });
  afterEach(async () => {
    uploads.onModuleDestroy();
    process.env.CONTENT_STORAGE_DIR = saved;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('assembles the pieces in order into the exact file, then hands it over once', async () => {
    const file = Buffer.alloc(UPLOAD_CHUNK_BYTES * 2 + 123, 0x41);
    file.write('ftyp', 4, 'latin1');
    const s = await uploads.start('u1', 'demo.mp4', file.length);
    expect(s.chunkBytes).toBe(UPLOAD_CHUNK_BYTES);
    let offset = 0;
    while (offset < file.length) {
      const r = await uploads.appendChunk(
        s.id,
        'u1',
        offset,
        piece(file.subarray(offset, offset + UPLOAD_CHUNK_BYTES)),
      );
      offset = r.received;
    }
    const taken = await uploads.take(s.id, 'u1');
    expect(taken.originalname).toBe('demo.mp4');
    expect((await fs.readFile(taken.path)).equals(file)).toBe(true);
    expect((await fs.stat(taken.path)).mode & 0o777).toBe(0o600);
    await expect(uploads.take(s.id, 'u1')).rejects.toThrow(NotFoundException);
  });

  it('a piece at the wrong offset is refused with the offset the upload expects (resume)', async () => {
    const s = await uploads.start('u1', 'a.pdf', 10);
    await uploads.appendChunk(s.id, 'u1', 0, piece(Buffer.from('%PDF-')));
    const err = await uploads
      .appendChunk(s.id, 'u1', 0, piece(Buffer.from('%PDF-')))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      received: 5,
    });
    await expect(
      uploads.appendChunk(s.id, 'u1', 7, piece(Buffer.from('x'))),
    ).rejects.toThrow(ConflictException);
  });

  it('an over-long piece is read to the end (up to 8 MB) and then refused with 413, so the answer can be delivered', async () => {
    const s = await uploads.start('u1', 'a.pdf', 10);
    const req = piece(Buffer.alloc(UPLOAD_CHUNK_BYTES + 1));
    await expect(uploads.appendChunk(s.id, 'u1', 0, req)).rejects.toThrow(
      PayloadTooLargeException,
    );
    expect((req as any).readableEnded).toBe(true); // drained, not cut off
    const huge = piece(Buffer.alloc(UPLOAD_DRAIN_BYTES + 1), undefined, 10); // lies about its length
    await expect(uploads.appendChunk(s.id, 'u1', 0, huge)).rejects.toThrow(
      PayloadTooLargeException,
    );
    expect((huge as any).destroyed).toBe(true); // past 8 MB: cut off
    const announced = piece(Buffer.alloc(1), undefined, UPLOAD_DRAIN_BYTES + 1);
    await expect(uploads.appendChunk(s.id, 'u1', 0, announced)).rejects.toThrow(
      PayloadTooLargeException,
    );
    expect((await fs.stat(path.join(tmp(), `${s.id}.upload`))).size).toBe(0);
  });

  it('refuses a piece over 4 MB, past the announced size, empty, or not octet-stream', async () => {
    const s = await uploads.start('u1', 'a.pdf', 10);
    await expect(
      uploads.appendChunk(
        s.id,
        'u1',
        0,
        piece(Buffer.alloc(UPLOAD_CHUNK_BYTES + 1)),
      ),
    ).rejects.toThrow(PayloadTooLargeException);
    // a client that under-declares its length is still cut off at the limit
    await expect(
      uploads.appendChunk(
        s.id,
        'u1',
        0,
        piece(Buffer.alloc(UPLOAD_CHUNK_BYTES + 1), undefined, 10),
      ),
    ).rejects.toThrow(PayloadTooLargeException);
    await expect(
      uploads.appendChunk(s.id, 'u1', 0, piece(Buffer.alloc(11))),
    ).rejects.toThrow(BadRequestException);
    await expect(
      uploads.appendChunk(s.id, 'u1', 0, piece(Buffer.alloc(0))),
    ).rejects.toThrow(BadRequestException);
    await expect(
      uploads.appendChunk(
        s.id,
        'u1',
        0,
        piece(Buffer.alloc(3), 'multipart/form-data'),
      ),
    ).rejects.toThrow(UnsupportedMediaTypeException);
    expect((await fs.stat(path.join(tmp(), `${s.id}.upload`))).size).toBe(0);
  });

  it('an incomplete upload is not handed over', async () => {
    const s = await uploads.start('u1', 'a.pdf', 10);
    await uploads.appendChunk(s.id, 'u1', 0, piece(Buffer.alloc(4)));
    await expect(uploads.take(s.id, 'u1')).rejects.toThrow(ConflictException);
  });

  it("another user's upload is not found (and not revealed); a malformed id is not found", async () => {
    const s = await uploads.start('u1', 'a.pdf', 10);
    await expect(
      uploads.appendChunk(s.id, 'u2', 0, piece(Buffer.alloc(1))),
    ).rejects.toThrow(NotFoundException);
    await expect(uploads.take(s.id, 'u2')).rejects.toThrow(NotFoundException);
    await expect(uploads.cancel(s.id, 'u2')).rejects.toThrow(NotFoundException);
    await expect(uploads.take('../../etc/passwd', 'u1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('refuses a file type or size that can never be accepted, and a fourth open upload', async () => {
    await expect(uploads.start('u1', 'page.html', 10)).rejects.toThrow(
      UnsupportedMediaTypeException,
    );
    await expect(uploads.start('u1', 'logo.svg', 10)).rejects.toThrow(
      UnsupportedMediaTypeException,
    );
    await expect(
      uploads.start('u1', 'big.mp4', 200 * 1024 * 1024 + 1),
    ).rejects.toThrow(PayloadTooLargeException);
    for (let i = 0; i < MAX_OPEN_UPLOADS_PER_USER; i++)
      await uploads.start('u1', `v${i}.mp4`, 10);
    await expect(uploads.start('u1', 'v9.mp4', 10)).rejects.toThrow(
      HttpException,
    );
    await expect(uploads.start('u2', 'v9.mp4', 10)).resolves.toBeTruthy();
  });

  it('cancel removes the upload and its bytes', async () => {
    const s = await uploads.start('u1', 'a.pdf', 10);
    await uploads.appendChunk(s.id, 'u1', 0, piece(Buffer.alloc(4)));
    await uploads.cancel(s.id, 'u1');
    expect(await fs.readdir(tmp())).toEqual([]);
  });

  it('the sweep removes idle uploads and interrupted single-request uploads, and keeps active ones', async () => {
    const idle = await uploads.start('u1', 'a.pdf', 10);
    const active = await uploads.start('u2', 'b.pdf', 10);
    const partial = path.join(
      tmp(),
      '00000000-0000-4000-8000-000000000009.upload',
    );
    await fs.writeFile(partial, Buffer.alloc(100));
    const old = new Date(Date.now() - UPLOAD_IDLE_MS - 60_000);
    for (const f of [`${idle.id}.upload`, `${idle.id}.session.json`])
      await fs.utimes(path.join(tmp(), f), old, old);
    await fs.utimes(partial, old, old);
    expect(await uploads.sweep()).toBe(3);
    expect((await fs.readdir(tmp())).sort()).toEqual(
      [`${active.id}.session.json`, `${active.id}.upload`].sort(),
    );
  });

  it('an upload whose bytes are still being written is not swept even if its state file is old', async () => {
    const s = await uploads.start('u1', 'a.pdf', 10);
    const old = new Date(Date.now() - UPLOAD_IDLE_MS - 60_000);
    await fs.utimes(path.join(tmp(), `${s.id}.session.json`), old, old);
    expect(await uploads.sweep()).toBe(0);
  });
});

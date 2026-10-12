/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../../core/auth/auth.module';
import { DatabaseModule } from '../../../core/database/database.module';
import { PrismaService } from '../../../core/database/prisma.service';
import { ContentLibraryModule } from './content-library.module';
import { signContentAccess } from './content-access';
import { PDF, jpeg } from './content-fixtures.helper-spec';

const SECRET = process.env.JWT_SECRET || 'texzium-secret';
const token = (permissions: string[]) =>
  new JwtService({ secret: SECRET }).sign(
    { sub: 'u-1', email: 'u@example.invalid', role: 'TEST', permissions },
    { expiresIn: '1h' },
  );

const ASSET = '00000000-0000-4000-8000-0000000000a1';
const FILE = '00000000-0000-4000-8000-0000000000f1';
const OTHER_FILE = '00000000-0000-4000-8000-0000000000f2';
const KEY = 'ab/abcdef01-2345-6789-abcd-ef0123456789.jpg';

// Every route with the permissions it needs. Uploads are sent as real multipart bodies.
const ROUTES: Array<{
  name: string;
  perms: string[];
  send: (t: string | null) => request.Test;
  upload?: boolean;
}> = [];

describe('content library: who may do what (real JWT and permission guards)', () => {
  let app: INestApplication;
  let root: string;
  let savedRoot: string | undefined;
  let savedSecret: string | undefined;
  const touched: string[] = [];
  // any database access fails the request: only the signed file route may reach it
  const db: any = new Proxy(
    {},
    {
      get: (_t, model: string) =>
        model === 'contentFile'
          ? {
              findUnique: jest.fn(async ({ where }: any) => {
                touched.push(`contentFile.findUnique:${where.id}`);
                return where.id === FILE
                  ? {
                      storageKey: KEY,
                      mimeType: 'image/jpeg',
                      version: 2,
                      asset: { title: 'Pump 5HP / front' },
                    }
                  : null;
              }),
            }
          : new Proxy(
              {},
              {
                get: (_t2, method: string) => () => {
                  touched.push(`${String(model)}.${method}`);
                  throw new Error('must not be reached');
                },
              },
            ),
    },
  );
  const server = () => app.getHttpServer();
  const withToken = (r: request.Test, t: string | null) =>
    t ? r.set('Authorization', `Bearer ${t}`) : r;

  beforeAll(async () => {
    savedRoot = process.env.CONTENT_STORAGE_DIR;
    savedSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = SECRET;
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-http-'));
    process.env.CONTENT_STORAGE_DIR = root;
    await fs.mkdir(path.join(root, 'files', 'ab'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'files', KEY),
      Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule, ContentLibraryModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const up = (url: string) => (t: string | null) =>
      withToken(request(server()).post(url), t)
        .field('title', 'Pump brochure')
        .field('kind', 'PHOTO')
        .attach('file', jpeg(), 'pump.jpg');
    ROUTES.push(
      {
        name: 'GET /content-assets',
        perms: ['content.view'],
        send: (t) => withToken(request(server()).get('/content-assets'), t),
      },
      {
        name: 'GET /content-assets/:id',
        perms: ['content.view'],
        send: (t) =>
          withToken(request(server()).get(`/content-assets/${ASSET}`), t),
      },
      {
        name: 'POST /content-assets',
        perms: ['content.manage'],
        send: up('/content-assets'),
        upload: true,
      },
      {
        name: 'PATCH /content-assets/:id',
        perms: ['content.manage'],
        send: (t) =>
          withToken(
            request(server()).patch(`/content-assets/${ASSET}`),
            t,
          ).send({ title: 'x' }),
      },
      {
        name: 'POST /content-assets/:id/versions',
        perms: ['content.manage'],
        send: up(`/content-assets/${ASSET}/versions`),
        upload: true,
      },
      {
        name: 'POST /content-assets/:id/archive',
        perms: ['content.manage'],
        send: (t) =>
          withToken(
            request(server()).post(`/content-assets/${ASSET}/archive`),
            t,
          ).send({ reason: 'old model' }),
      },
      {
        name: 'POST /content-assets/:id/restore',
        perms: ['content.manage'],
        send: (t) =>
          withToken(
            request(server()).post(`/content-assets/${ASSET}/restore`),
            t,
          ),
      },
      {
        name: 'POST /content-assets/:id/access-url',
        perms: ['content.view'],
        send: (t) =>
          withToken(
            request(server()).post(`/content-assets/${ASSET}/access-url`),
            t,
          ).send({ disposition: 'inline' }),
      },
      {
        name: 'POST /content-assets/:id/shares',
        perms: ['content.view', 'content.share'],
        send: (t) =>
          withToken(
            request(server()).post(`/content-assets/${ASSET}/shares`),
            t,
          ).send({
            targetType: 'LEAD',
            targetId: ASSET,
            channel: 'WHATSAPP',
          }),
      },
      {
        name: 'GET /content-assets/:id/shares',
        perms: ['content.view'],
        send: (t) =>
          withToken(
            request(server()).get(`/content-assets/${ASSET}/shares`),
            t,
          ),
      },
      {
        name: 'POST /content-uploads',
        perms: ['content.manage'],
        send: (t) =>
          withToken(request(server()).post('/content-uploads'), t).send({
            fileName: 'a.mp4',
            sizeBytes: 10,
          }),
      },
      {
        name: 'PUT /content-uploads/:id/chunks',
        perms: ['content.manage'],
        send: (t) =>
          withToken(
            request(server()).put(`/content-uploads/${ASSET}/chunks?offset=0`),
            t,
          )
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from('0123456789')),
      },
      {
        name: 'DELETE /content-uploads/:id',
        perms: ['content.manage'],
        send: (t) =>
          withToken(request(server()).delete(`/content-uploads/${ASSET}`), t),
      },
    );
  });

  afterAll(async () => {
    await app?.close();
    process.env.CONTENT_STORAGE_DIR = savedRoot;
    process.env.JWT_SECRET = savedSecret;
    await fs.rm(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    touched.length = 0;
  });

  const tmpFiles = async () =>
    (await fs.readdir(path.join(root, 'tmp')).catch(() => [])).length;

  it('every content route answers 401 without a token, before anything is read or stored', async () => {
    expect(ROUTES).toHaveLength(13);
    for (const route of ROUTES) {
      const res = await route.send(null);
      expect([route.name, res.status]).toEqual([route.name, 401]);
    }
    expect(touched).toEqual([]);
    expect(await tmpFiles()).toBe(0);
  });

  it('every content route answers 403 to a token lacking any one of its permissions, before anything is read or stored', async () => {
    const all = [
      'content.view',
      'content.manage',
      'content.share',
      'leads.view',
      'customers.view',
      'documents.view',
    ];
    for (const route of ROUTES) {
      for (const missing of route.perms) {
        const res = await route.send(token(all.filter((p) => p !== missing)));
        expect([route.name, missing, res.status]).toEqual([
          route.name,
          missing,
          403,
        ]);
      }
    }
    expect(touched).toEqual([]);
    expect(await tmpFiles()).toBe(0);
  });

  it('with its permissions, a route passes the guards (and reaches the database)', async () => {
    const res = await request(server())
      .get(`/content-assets/${ASSET}`)
      .set('Authorization', `Bearer ${token(['content.view'])}`);
    expect(res.status).toBe(500); // the double refuses: proof the guards let it through
    expect(touched).toContain('contentAsset.findUnique');
  });

  it('an upload refused by validation leaves no temporary file behind', async () => {
    const res = await request(server())
      .post('/content-assets')
      .set('Authorization', `Bearer ${token(['content.manage'])}`)
      .field('title', 'x')
      .field('kind', 'AUDIO')
      .attach('file', PDF, 'a.pdf');
    expect(res.status).toBe(400);
    expect(await tmpFiles()).toBe(0);
    expect(touched).toEqual([]);
  });

  describe('GET /content-files/:fileId (signed, no login token)', () => {
    const signed = (fileId = FILE, disp: 'inline' | 'attachment' = 'inline') =>
      signContentAccess(fileId, disp).url;

    it('without a signature, or with a wrong one, it is 403 and nothing is looked up', async () => {
      const good = new URL(signed(), 'http://x');
      const cases = [
        `/content-files/${FILE}`,
        `/content-files/${FILE}?exp=${good.searchParams.get('exp')}&disp=inline&sig=${'A'.repeat(43)}`,
        `/content-files/${FILE}?exp=${good.searchParams.get('exp')}&disp=attachment&sig=${good.searchParams.get('sig')}`,
        `/content-files/${OTHER_FILE}${good.search}`,
        `/content-files/${FILE}?exp=1000&disp=inline&sig=${good.searchParams.get('sig')}`,
      ];
      for (const url of cases) {
        const res = await request(server()).get(url);
        expect([url, res.status]).toEqual([url, 403]);
        expect(res.text).not.toMatch(/root|tmp|files|ab\//);
      }
      expect(touched).toEqual([]);
    });

    it('a malformed id or an unknown query parameter is 400', async () => {
      expect(
        (await request(server()).get('/content-files/not-a-uuid')).status,
      ).toBe(400);
      expect(
        (await request(server()).get(`${signed()}&path=/etc/passwd`)).status,
      ).toBe(400);
      expect(touched).toEqual([]);
    });

    it('a valid URL serves the file with safe headers, and never the storage path', async () => {
      const res = await request(server()).get(signed()).buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toBe(
        'inline; filename="Pump-5HP-front-v2.jpg"',
      );
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-length']).toBe('36');
      expect(res.headers['cache-control']).toMatch(
        /^private, max-age=\d+, no-transform$/,
      );
      expect(Buffer.from(res.body).toString()).toBe(
        '0123456789abcdefghijklmnopqrstuvwxyz',
      );
      const attachment = await request(server()).get(
        signed(FILE, 'attachment'),
      );
      expect(attachment.headers['content-disposition']).toBe(
        'attachment; filename="Pump-5HP-front-v2.jpg"',
      );
    });

    it('byte ranges: 206 with Content-Range, a suffix range, and 416 past the end', async () => {
      const r1 = await request(server())
        .get(signed())
        .set('Range', 'bytes=10-19')
        .buffer(true);
      expect(r1.status).toBe(206);
      expect(r1.headers['content-range']).toBe('bytes 10-19/36');
      expect(r1.headers['content-length']).toBe('10');
      expect(Buffer.from(r1.body).toString()).toBe('abcdefghij');
      const r2 = await request(server())
        .get(signed())
        .set('Range', 'bytes=-6')
        .buffer(true);
      expect([r2.status, Buffer.from(r2.body).toString()]).toEqual([
        206,
        'uvwxyz',
      ]);
      const r3 = await request(server())
        .get(signed())
        .set('Range', 'bytes=36-');
      expect([r3.status, r3.headers['content-range']]).toEqual([
        416,
        'bytes */36',
      ]);
    });

    it('a signed URL for a file that does not exist is 404', async () => {
      const res = await request(server()).get(signed(OTHER_FILE));
      expect(res.status).toBe(404);
    });
  });
});

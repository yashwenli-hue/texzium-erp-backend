/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await, @typescript-eslint/unbound-method -- test doubles are intentionally loosely typed */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../core/auth/auth.module';
import { DatabaseModule } from '../../core/database/database.module';
import { PrismaService } from '../../core/database/prisma.service';
import { PERMISSIONS_KEY } from '../../core/decorators/permissions.decorator';
import { DocumentController } from './document.controller';
import { DocumentModule } from './document.module';
import { DocumentService } from './document.service';
import { DOCUMENT_UPLOADS_ROOT } from './document-storage';

// /documents through real HTTP: the real global JwtAuthGuard and JWT strategy, the
// global credential-redaction interceptor, PermissionsGuard, ValidationPipe, the real
// service and real (synthetic) files in a temporary directory. Only Prisma is a double.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-http-'));
const root = path.join(tmp, 'uploads');
const SECRET = 'SYNTHETIC-SECRET-VALUE';
const PDF = '%PDF-1.4 synthetic commissioning certificate';

const rows: Record<string, any> = {
  good: {
    id: 'good',
    documentName: 'Certificate',
    documentType: 'COMMISSIONING_CERTIFICATE',
    moduleName: 'OperationsOS',
    referenceId: 'c-1',
    filePath: './uploads/commissioning-c-1.pdf',
    status: 'ACTIVE',
    remarks: null,
  },
  climb: { id: 'climb', filePath: '../outside/secret.txt' },
  hidden: { id: 'hidden', filePath: './uploads/../outside/secret.txt' },
  absolute: {
    id: 'absolute',
    filePath: path.join(tmp, 'outside', 'secret.txt'),
  },
  symlink: { id: 'symlink', filePath: './uploads/link.pdf' },
  linkdir: { id: 'linkdir', filePath: './uploads/linkdir/secret.txt' },
  directory: { id: 'directory', filePath: './uploads/sub' },
  missing: { id: 'missing', filePath: './uploads/gone.pdf' },
  hardlink: { id: 'hardlink', filePath: './uploads/hard.txt' },
};

function token(permissions: string[]) {
  return new JwtService({
    secret: process.env.JWT_SECRET || 'texzium-secret',
  }).sign(
    { sub: 'u-1', email: 'u@example.invalid', role: 'TEST', permissions },
    { expiresIn: '1h' },
  );
}

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('/documents', () => {
  let app: INestApplication;
  let service: DocumentService;
  const db: any = {
    document: {
      findMany: jest.fn(async (args: any) => {
        // Honour the select, as Prisma does.
        const picked = Object.values(rows)
          .filter((r) => r.documentName)
          .map((r) =>
            Object.fromEntries(Object.keys(args.select).map((k) => [k, r[k]])),
          );
        return picked;
      }),
      findUnique: jest.fn(async (args: any) => {
        const r = rows[args.where.id];
        return r
          ? Object.fromEntries(Object.keys(args.select).map((k) => [k, r[k]]))
          : null;
      }),
      create: jest.fn(async (args: any) => ({ id: 'new', ...args.data })),
    },
  };

  beforeAll(async () => {
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'outside'));
    fs.writeFileSync(path.join(tmp, 'outside', 'secret.txt'), SECRET);
    fs.writeFileSync(path.join(root, 'commissioning-c-1.pdf'), PDF);
    fs.symlinkSync(
      path.join(tmp, 'outside', 'secret.txt'),
      path.join(root, 'link.pdf'),
    );
    fs.symlinkSync(path.join(tmp, 'outside'), path.join(root, 'linkdir'));
    fs.linkSync(
      path.join(tmp, 'outside', 'secret.txt'),
      path.join(root, 'hard.txt'),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule, DocumentModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(DOCUMENT_UPLOADS_ROOT)
      .useValue(root)
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
    service = moduleRef.get(DocumentService);
  });

  afterAll(async () => {
    await app?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => jest.clearAllMocks());

  const get = (
    url: string,
    permissions: string[] | null = ['documents.view'],
  ) => {
    const req = request(app.getHttpServer()).get(url);
    if (permissions) req.set('Authorization', `Bearer ${token(permissions)}`);
    return req;
  };

  it('declares documents.view on both routes', () => {
    const p = DocumentController.prototype;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.findAll)).toEqual([
      'documents.view',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.download)).toEqual([
      'documents.view',
    ]);
  });

  describe('access', () => {
    it.each(['/documents', '/documents/good/download'])(
      '%s: 401 without a token',
      async (url) => {
        expect((await get(url, null)).status).toBe(401);
        expect(db.document.findMany).not.toHaveBeenCalled();
        expect(db.document.findUnique).not.toHaveBeenCalled();
      },
    );

    it.each(['/documents', '/documents/good/download'])(
      '%s: 403 without documents.view, even with many other permissions',
      async (url) => {
        const res = await get(url, [
          'leads.view',
          'users.view',
          'customers.view',
          'whatsapp.config.view',
        ]);
        expect(res.status).toBe(403);
        expect(db.document.findMany).not.toHaveBeenCalled();
        expect(db.document.findUnique).not.toHaveBeenCalled();
      },
    );
  });

  describe('the removed routes are gone', () => {
    it('POST /documents/upload is a 404, even with the permission', async () => {
      const res = await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${token(['documents.view'])}`)
        .send({
          documentName: 'x',
          documentType: 'x',
          moduleName: 'x',
          referenceId: 'x',
          filePath: '/etc/passwd',
        });
      expect(res.status).toBe(404);
      expect(db.document.create).not.toHaveBeenCalled();
    });

    it.each(['/documents/module/OperationsOS', '/documents/reference/c-1'])(
      'GET %s is a 404',
      async (url) => {
        expect((await get(url)).status).toBe(404);
      },
    );
  });

  describe('listing', () => {
    it('lists documents without any file path', async () => {
      const res = await get('/documents');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toMatch(/filePath|uploads|outside/);
      expect(Object.keys(res.body[0]).sort()).toEqual(
        [
          'createdAt',
          'documentName',
          'documentType',
          'id',
          'moduleName',
          'referenceId',
          'remarks',
          'status',
          'updatedAt',
        ]
          .filter((k) => k in res.body[0])
          .sort(),
      );
      expect(
        db.document.findMany.mock.calls[0][0].select.filePath,
      ).toBeUndefined();
    });

    it('filters by moduleName and referenceId', async () => {
      await get('/documents?moduleName=OperationsOS&referenceId=c-1');
      expect(db.document.findMany.mock.calls[0][0].where).toEqual({
        moduleName: 'OperationsOS',
        referenceId: 'c-1',
      });
    });

    it('refuses unknown query parameters', async () => {
      expect((await get('/documents?filePath=/etc/passwd')).status).toBe(400);
      expect(db.document.findMany).not.toHaveBeenCalled();
    });
  });

  describe('downloading', () => {
    it('serves a commissioning certificate inside the uploads directory, with safe headers', async () => {
      const res = await get('/documents/good/download')
        .buffer(true)
        .parse(binary);
      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe(PDF);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="commissioning-c-1.pdf"',
      );
      expect(res.headers['content-length']).toBe(String(PDF.length));
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('404 for a document that does not exist', async () => {
      const res = await get('/documents/nope/download');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Document not found.');
    });

    it.each([
      'climb',
      'hidden',
      'absolute',
      'symlink',
      'linkdir',
      'directory',
      'missing',
      'hardlink',
    ])(
      'stored path "%s": 404, and neither the file nor its path is revealed',
      async (id) => {
        const res = await get(`/documents/${id}/download`)
          .buffer(true)
          .parse(binary);
        expect(res.status).toBe(404);
        const text = res.body.toString();
        expect(text).not.toContain(SECRET);
        expect(text).not.toMatch(/outside|uploads|secret|\.\./);
        expect(JSON.parse(text).message).toBe(
          'The file for this document is not available.',
        );
      },
    );
  });

  describe('registering (internal, used by commissioning certificates)', () => {
    it('registers the commissioning path and returns no file path', async () => {
      const created = await service.create({
        documentName: 'Commissioning Certificate - SN1',
        documentType: 'COMMISSIONING_CERTIFICATE',
        moduleName: 'OperationsOS',
        referenceId: 'c-2',
        filePath: './uploads/commissioning-c-2.pdf',
      });
      expect(db.document.create).toHaveBeenCalledTimes(1);
      expect(db.document.create.mock.calls[0][0].data.filePath).toBe(
        './uploads/commissioning-c-2.pdf',
      );
      expect(
        db.document.create.mock.calls[0][0].select.filePath,
      ).toBeUndefined();
      expect(created.id).toBe('new');
    });

    it.each(['../outside/secret.txt', '/etc/passwd', './uploads/link.pdf'])(
      'refuses to register %s',
      async (filePath) => {
        await expect(
          service.create({
            documentName: 'x',
            documentType: 'x',
            moduleName: 'x',
            referenceId: 'x',
            filePath,
          }),
        ).rejects.toThrow(
          'A document file must be inside the uploads directory.',
        );
        expect(db.document.create).not.toHaveBeenCalled();
      },
    );
  });
});

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import PDFDocument from 'pdfkit';

import { AuthModule } from '../../../core/auth/auth.module';
import { DatabaseModule } from '../../../core/database/database.module';
import { PrismaService } from '../../../core/database/prisma.service';
import { PERMISSIONS_KEY } from '../../../core/decorators/permissions.decorator';
import { DocumentProfileController } from './document-profile.controller';
import { DocumentProfileModule } from './document-profile.module';
import { loadDocumentIssuer } from './document-identity';

function token(permissions: string[], sub = 'u-1') {
  return new JwtService({
    secret: process.env.JWT_SECRET || 'texzium-secret',
  }).sign(
    { sub, email: 'u@example.invalid', role: 'TEST', permissions },
    { expiresIn: '1h' },
  );
}

// A real 1x1 PNG, made by pdfkit's own image reader's counterpart: a known
// minimal PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const COMPANY = {
  id: 'co-1',
  companyCode: 'TX001',
  companyName: 'Texzium Industries Private Limited',
  panNumber: 'AAACT1234A',
  cinNumber: 'U12345GJ2020PTC123456',
  email: 'sales@texzium.example',
  phone: '+91 79 0000 0000',
  website: null,
  isActive: true,
  createdAt: new Date(),
};
const REG = {
  id: 'reg-24',
  companyId: 'co-1',
  gstin: '24AAACT1234A1Z5',
  legalName: 'Texzium Industries Private Limited',
  tradeName: 'Texzium',
  addressLine1: 'Plot 7, GIDC',
  addressLine2: null,
  city: 'Ahmedabad',
  pincode: '382445',
  stateCode: '24',
  stateName: 'Gujarat',
  isDefault: true,
  isActive: true,
  createdAt: new Date(),
};

describe('/document-profile', () => {
  let app: INestApplication;
  let profile: any;
  let companies: any[];
  const db: any = {
    company: {
      findMany: jest.fn(async () => companies),
      findUnique: jest.fn(async () => COMPANY),
      findFirst: jest.fn(async () => COMPANY),
    },
    companyGSTRegistration: {
      findMany: jest.fn(async () => [REG]),
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === REG.id ? REG : null,
      ),
      findFirst: jest.fn(async () => REG),
    },
    companyDocumentProfile: {
      findUnique: jest.fn(async () => profile),
      upsert: jest.fn(async ({ create, update }: any) => {
        profile = profile
          ? { ...profile, ...update, updatedAt: new Date() }
          : { ...create, updatedAt: new Date() };
        return profile;
      }),
    },
    user: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === 'u-1' ? { id: 'u-1' } : null,
      ),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule, DocumentProfileModule],
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
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    profile = null;
    companies = [COMPANY];
  });

  const auth = `Bearer ${token(['documents.profile.manage'])}`;
  const put = (body: object, a = auth) =>
    request(app.getHttpServer())
      .put('/document-profile')
      .set('Authorization', a)
      .send(body);

  it('declares documents.profile.manage for reading and changing', () => {
    for (const m of ['get', 'update', 'setLogo', 'removeLogo'] as const)
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          DocumentProfileController.prototype[m],
        ),
      ).toEqual(['documents.profile.manage']);
  });

  it('refuses without a token (401) and without the permission (403); nothing is written', async () => {
    const server = app.getHttpServer();
    await request(server).get('/document-profile').expect(401);
    await request(server)
      .get('/document-profile')
      .set('Authorization', `Bearer ${token(['customers.view'])}`)
      .expect(403);
    await put({ bankName: 'X' }, `Bearer ${token(['documents.view'])}`).expect(
      403,
    );
    expect(db.companyDocumentProfile.upsert).not.toHaveBeenCalled();
  });

  it('reads the company, its registrations and an empty profile', async () => {
    const res = await request(app.getHttpServer())
      .get('/document-profile')
      .set('Authorization', auth)
      .expect(200);
    expect(res.body.company).toMatchObject({ companyCode: 'TX001' });
    expect(res.body.registrations).toHaveLength(1);
    expect(res.body.profile).toMatchObject({
      bankName: null,
      logo: null,
      signatoryName: null,
    });
  });

  it('saves trimmed, validated values and records who changed them; a field left out keeps its value; null clears', async () => {
    await put({
      bankAccountName: '  Texzium Industries Pvt Ltd ',
      bankName: 'HDFC Bank',
      bankAccountNumber: '5020 0012 3456 78',
      bankIfsc: 'hdfc0000123',
      upiId: 'texzium@hdfcbank',
      signatoryName: 'A. Mehta',
      invoiceTerms:
        'Payment within 30 days.\nInterest at 18% after the due date.',
    }).expect(200);
    expect(profile).toMatchObject({
      bankAccountName: 'Texzium Industries Pvt Ltd',
      bankAccountNumber: '50200012345678',
      bankIfsc: 'HDFC0000123',
      updatedById: 'u-1',
    });
    const res = await put({ signatoryName: null, bankBranch: 'Navrangpura' });
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({
      bankName: 'HDFC Bank',
      signatoryName: null,
      bankBranch: 'Navrangpura',
    });
  });

  it.each([
    ['an IFSC that is not one', { bankIfsc: 'HDFC123' }],
    ['an account number with letters', { bankAccountNumber: '12AB345678' }],
    ['a UPI id without a handle', { upiId: 'texzium' }],
    ['an unknown field', { gstin: 'x' }],
    ['terms that are too long', { invoiceTerms: 'x'.repeat(4001) }],
    [
      'a logo sent with the text fields (it has its own route)',
      { logo: { mimeType: 'image/png', base64: 'AAAA' } },
    ],
  ])('refuses %s (400) and writes nothing', async (_n, body) => {
    await put(body).expect(400);
    expect(db.companyDocumentProfile.upsert).not.toHaveBeenCalled();
  });

  it('PUT /document-profile/logo stores a real PNG and returns it; refuses another type, a file that only claims to be a PNG, an unreadable or too large one; DELETE removes it', async () => {
    const putLogo = (body: object, a = auth) =>
      request(app.getHttpServer())
        .put('/document-profile/logo')
        .set('Authorization', a)
        .send(body);

    await putLogo(
      { mimeType: 'image/png', base64: PNG.toString('base64') },
      `Bearer ${token(['customers.view'])}`,
    ).expect(403);
    const ok = await putLogo({
      mimeType: 'image/png',
      base64: PNG.toString('base64'),
    }).expect(200);
    expect(ok.body.profile.logo).toEqual({
      mimeType: 'image/png',
      base64: PNG.toString('base64'),
    });
    expect(Buffer.compare(profile.logoData, PNG)).toBe(0);

    await putLogo({ mimeType: 'image/svg+xml', base64: 'PHN2Zz4=' }).expect(
      400,
    );
    const fake = Buffer.from('<svg onload=alert(1)>').toString('base64');
    const r1 = await putLogo({ mimeType: 'image/png', base64: fake });
    expect(r1.status).toBe(400);
    expect(r1.body.message).toMatch(/not a PNG or JPEG/);

    const truncated = PNG.subarray(0, 20).toString('base64');
    const r2 = await putLogo({ mimeType: 'image/png', base64: truncated });
    expect(r2.status).toBe(400);
    expect(r2.body.message).toMatch(/cannot be read/);

    const big = Buffer.concat([PNG, Buffer.alloc(66 * 1024)]).toString(
      'base64',
    );
    expect((await putLogo({ mimeType: 'image/png', base64: big })).status).toBe(
      400,
    );
    expect(Buffer.compare(profile.logoData, PNG)).toBe(0);

    await request(app.getHttpServer())
      .delete('/document-profile/logo')
      .set('Authorization', auth)
      .expect(200);
    expect(profile.logoData).toBeNull();
    expect(profile.logoMimeType).toBeNull();
  });

  it('refuses to guess between several active companies (409)', async () => {
    companies = [COMPANY, { ...COMPANY, id: 'co-2' }];
    await request(app.getHttpServer())
      .get('/document-profile')
      .set('Authorization', auth)
      .expect(409);
  });

  it('the issuer of a document: the registration, the company, and only what the profile holds', async () => {
    profile = {
      bankAccountName: 'Texzium Industries Pvt Ltd',
      bankName: 'HDFC Bank',
      bankBranch: null,
      bankAccountNumber: '50200012345678',
      bankIfsc: 'HDFC0000123',
      upiId: null,
      registeredOfficeAddress: 'Plot 1\nAhmedabad',
      invoiceTerms: 'Line 1\n\nLine 2',
      signatoryName: 'A. Mehta',
      signatoryDesignation: 'Director',
      logoData: PNG,
    };
    const issuer = await loadDocumentIssuer(db, 'reg-24');
    expect(issuer.identity).toMatchObject({
      legalName: 'Texzium Industries Private Limited',
      tradeName: 'Texzium',
      addressLines: ['Plot 7, GIDC', 'Ahmedabad 382445'],
      details: [
        'GSTIN 24AAACT1234A1Z5 · Gujarat (24)',
        'PAN AAACT1234A · CIN U12345GJ2020PTC123456',
        'Registered office: Plot 1, Ahmedabad',
        'sales@texzium.example · +91 79 0000 0000',
      ],
    });
    expect(issuer.bankLines).toEqual([
      'Texzium Industries Pvt Ltd · HDFC Bank',
      'A/c 50200012345678 · IFSC HDFC0000123',
    ]);
    expect(issuer.terms.invoice).toEqual(['Line 1', 'Line 2']);
    expect(issuer.signatory).toEqual({
      name: 'A. Mehta',
      designation: 'Director',
    });

    // the logo a profile holds is one pdfkit can draw
    expect(() =>
      new PDFDocument({ size: [10, 10] }).image(issuer.identity.logo!, 0, 0, {
        width: 10,
      }),
    ).not.toThrow();

    profile = null;
    const bare = await loadDocumentIssuer(db, 'reg-24');
    expect(bare.bankLines).toEqual([]);
    expect(bare.terms.invoice).toEqual([]);
    expect(bare.identity.logo).toBeNull();
  });
});

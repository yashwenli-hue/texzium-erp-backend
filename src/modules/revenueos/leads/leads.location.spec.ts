/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import * as fs from 'fs';
import * as path from 'path';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { LEAD_DEACTIVATED_MESSAGE } from './lead-lifecycle';
import { LEAD_LOCATION_MESSAGE } from './lead-location';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const ALL = ['leads.view', 'leads.create', 'leads.edit'];

interface FakeLead {
  id: string;
  customerName: string;
  phone: string;
  isActive: boolean;
  country: string | null;
  state: string | null;
  city: string | null;
}

describe('Lead location (create and edit)', () => {
  let app: INestApplication;
  let user: { id?: string; permissions?: string[] };
  let leads: Record<string, FakeLead>;
  let created: any[];
  let updates: any[];
  let timeline: any[];

  const db: any = {
    leadSource: {
      findUnique: jest.fn(async (a: any) =>
        a.where.id === SOURCE_ID ? { id: SOURCE_ID } : null,
      ),
    },
    lead: {
      create: jest.fn(async (a: any) => {
        created.push(a.data);
        return { id: 'new-lead', ...a.data };
      }),
      findUnique: jest.fn(async (a: any) =>
        leads[a.where.id] ? { ...leads[a.where.id] } : null,
      ),
      update: jest.fn(async (a: any) => {
        updates.push(a.data);
        Object.assign(
          leads[a.where.id],
          Object.fromEntries(
            Object.entries(a.data).filter(([, v]) => v !== undefined),
          ),
        );
        return { ...leads[a.where.id] };
      }),
    },
    leadTimeline: {
      create: jest.fn(async (a: any) => {
        timeline.push(a.data);
        return { id: 't', ...a.data };
      }),
    },
    // Edits run in a transaction under the shared lock on the lead (FOR SHARE).
    $queryRaw: jest.fn(async () => [{ id: 'lead', isActive: true }]),
    $transaction: jest.fn(async (fn: any) => fn(db)),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LeadsController],
      providers: [LeadsService, { provide: PrismaService, useValue: db }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = user;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
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
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    user = { id: 'user-1', permissions: ALL };
    created = [];
    updates = [];
    timeline = [];
    leads = {
      [LEAD_ID]: {
        id: LEAD_ID,
        customerName: 'Old',
        phone: '9876543210',
        isActive: true,
        country: null,
        state: null,
        city: null,
      },
    };
  });

  const http = () => request(app.getHttpServer());
  const base = {
    customerName: 'Sterling Pumps',
    phone: '9876543210',
    sourceId: SOURCE_ID,
  };
  const create = (extra: object = {}) =>
    http()
      .post('/leads')
      .send({ ...base, ...extra });
  const edit = (body: object, id = LEAD_ID) =>
    http().patch(`/leads/${id}`).send(body);

  describe('creating a lead', () => {
    it('stores a location of null, null, null when none is given and infers nothing from the phone', async () => {
      for (const phone of [
        '9876543210',
        '+91 98765 43210',
        '919876543210',
        '+971 50 123 4567',
        '+1 202 555 0100',
      ]) {
        created = [];
        const res = await create({ phone });
        expect(res.status).toBe(201);
        expect(created[0]).toMatchObject({
          phone,
          country: null,
          state: null,
          city: null,
        });
      }
    });

    it('stores a domestic location', async () => {
      const res = await create({
        country: 'IN',
        state: 'Maharashtra',
        city: 'Pune',
      });
      expect(res.status).toBe(201);
      expect(created[0]).toMatchObject({
        country: 'IN',
        state: 'Maharashtra',
        city: 'Pune',
      });
    });

    it('stores an international location with no state', async () => {
      const res = await create({ country: 'AE', city: 'Dubai' });
      expect(res.status).toBe(201);
      expect(created[0]).toMatchObject({
        country: 'AE',
        state: null,
        city: 'Dubai',
      });
    });

    it('reads the values as typed: country upper-cased, state in its canonical spelling, blanks as none, ends trimmed', async () => {
      const res = await create({
        country: ' in ',
        state: 'tamil nadu',
        city: '  Chennai  ',
      });
      expect(res.status).toBe(201);
      expect(created[0]).toMatchObject({
        country: 'IN',
        state: 'Tamil Nadu',
        city: 'Chennai',
      });

      created = [];
      expect(
        (await create({ country: 'GB', state: '  ', city: '   ' })).status,
      ).toBe(201);
      expect(created[0]).toMatchObject({
        country: 'GB',
        state: null,
        city: null,
      });

      created = [];
      expect((await create({ country: '', state: '', city: '' })).status).toBe(
        201,
      );
      expect(created[0]).toMatchObject({
        country: null,
        state: null,
        city: null,
      });
    });

    it.each([
      [
        'India without a state',
        { country: 'IN' },
        LEAD_LOCATION_MESSAGE.STATE_REQUIRED,
      ],
      [
        'India with a city but no state',
        { country: 'IN', city: 'Pune' },
        LEAD_LOCATION_MESSAGE.STATE_REQUIRED,
      ],
      [
        'a state on a foreign country',
        { country: 'US', state: 'Maharashtra' },
        LEAD_LOCATION_MESSAGE.STATE_ONLY_IN_INDIA,
      ],
      [
        'a state with no country',
        { state: 'Maharashtra' },
        LEAD_LOCATION_MESSAGE.COUNTRY_REQUIRED,
      ],
      [
        'a city with no country',
        { city: 'Pune' },
        LEAD_LOCATION_MESSAGE.COUNTRY_REQUIRED,
      ],
    ])(
      "refuses %s with the rule's own message and writes nothing",
      async (_n, extra, message) => {
        const res = await create(extra);
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body.message)).toContain(message);
        expect(created).toEqual([]);
        expect(timeline).toEqual([]);
      },
    );

    it.each([
      ['an unknown country', { country: 'XX' }],
      ['a three-letter country', { country: 'IND' }],
      ['a retired code', { country: 'UK' }],
      ['an unknown state', { country: 'IN', state: 'Atlantis' }],
      ['"Other Territory"', { country: 'IN', state: 'Other Territory' }],
      [
        'a city over 100 characters',
        { country: 'IN', state: 'Goa', city: 'x'.repeat(101) },
      ],
      ['a numeric country', { country: 91 }],
      ['an object for the state', { country: 'IN', state: { name: 'Goa' } }],
      ['a numeric city', { country: 'IN', state: 'Goa', city: 5 }],
    ])('refuses %s with 400 and writes nothing', async (_n, extra) => {
      const res = await create(extra);
      expect(res.status).toBe(400);
      expect(created).toEqual([]);
    });

    it('still refuses fields that are not declared (no client-chosen id, actor or inferred value)', async () => {
      for (const extra of [
        { locationType: 'DOMESTIC' },
        { countryCode: '+91' },
        { id: 'x' },
        { isActive: false },
      ]) {
        expect((await create(extra)).status).toBe(400);
      }
      expect(created).toEqual([]);
    });

    it('is unchanged for a lead without location: the same fields as before are accepted', async () => {
      const res = await create({
        companyName: 'Sterling Pumps Pvt Ltd',
        email: 'a@b.co',
        alternatePhone: '+91 99999 99999',
      });
      expect(res.status).toBe(201);
      expect(timeline).toEqual([
        {
          leadId: 'new-lead',
          action: 'LEAD_CREATED',
          remarks: 'Lead created manually.',
        },
      ]);
    });
  });

  describe('editing a lead', () => {
    it('leaves a lead with no location untouched when only other things are edited', async () => {
      const res = await edit({ customerName: 'Renamed' });
      expect(res.status).toBe(200);
      expect(updates[0].country).toBeUndefined();
      expect(updates[0].state).toBeUndefined();
      expect(updates[0].city).toBeUndefined();
      expect(leads[LEAD_ID]).toMatchObject({
        country: null,
        state: null,
        city: null,
      });
    });

    it('sets a location on a lead that had none, and writes the history line as before', async () => {
      const res = await edit({
        country: 'IN',
        state: 'Gujarat',
        city: 'Surat',
      });
      expect(res.status).toBe(200);
      expect(leads[LEAD_ID]).toMatchObject({
        country: 'IN',
        state: 'Gujarat',
        city: 'Surat',
      });
      expect(timeline).toEqual([
        {
          leadId: LEAD_ID,
          action: 'LEAD_UPDATED',
          remarks: 'Lead information updated.',
        },
      ]);
    });

    it('changes only the city and keeps the country and state', async () => {
      leads[LEAD_ID] = {
        ...leads[LEAD_ID],
        country: 'IN',
        state: 'Gujarat',
        city: 'Surat',
      };
      expect((await edit({ city: 'Vadodara' })).status).toBe(200);
      expect(leads[LEAD_ID]).toMatchObject({
        country: 'IN',
        state: 'Gujarat',
        city: 'Vadodara',
      });
    });

    it('clears a field with null or blank', async () => {
      leads[LEAD_ID] = {
        ...leads[LEAD_ID],
        country: 'IN',
        state: 'Gujarat',
        city: 'Surat',
      };
      expect((await edit({ city: null })).status).toBe(200);
      expect(leads[LEAD_ID].city).toBeNull();
      expect((await edit({ country: null, state: '' })).status).toBe(200);
      expect(leads[LEAD_ID]).toMatchObject({ country: null, state: null });
    });

    it('moves a lead out of India only when the state goes in the same request', async () => {
      leads[LEAD_ID] = {
        ...leads[LEAD_ID],
        country: 'IN',
        state: 'Gujarat',
        city: 'Surat',
      };
      const refused = await edit({ country: 'AE' });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body.message)).toContain(
        LEAD_LOCATION_MESSAGE.STATE_ONLY_IN_INDIA,
      );
      expect(leads[LEAD_ID]).toMatchObject({ country: 'IN', state: 'Gujarat' });

      expect(
        (await edit({ country: 'AE', state: null, city: 'Dubai' })).status,
      ).toBe(200);
      expect(leads[LEAD_ID]).toMatchObject({
        country: 'AE',
        state: null,
        city: 'Dubai',
      });
    });

    it('moves a foreign lead into India only with a state', async () => {
      leads[LEAD_ID] = { ...leads[LEAD_ID], country: 'AE', city: 'Dubai' };
      expect((await edit({ country: 'IN' })).status).toBe(400);
      expect(leads[LEAD_ID].country).toBe('AE');
      expect((await edit({ country: 'IN', state: 'Goa' })).status).toBe(200);
      expect(leads[LEAD_ID]).toMatchObject({ country: 'IN', state: 'Goa' });
    });

    it('refuses a city alone on a lead that has no country, and an invalid value, changing nothing', async () => {
      expect((await edit({ city: 'Pune' })).status).toBe(400);
      expect((await edit({ country: 'ZZ' })).status).toBe(400);
      expect((await edit({ country: 'IN', state: 'Mars' })).status).toBe(400);
      expect(updates).toEqual([]);
      expect(timeline).toEqual([]);
    });

    it('does not infer a country when the phone is edited', async () => {
      expect((await edit({ phone: '+971 50 123 4567' })).status).toBe(200);
      expect(leads[LEAD_ID]).toMatchObject({
        phone: '+971 50 123 4567',
        country: null,
      });
    });

    it('is refused for a deactivated lead exactly as before, location or not', async () => {
      leads[LEAD_ID].isActive = false;
      const res = await edit({ country: 'IN', state: 'Goa' });
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).toContain(LEAD_DEACTIVATED_MESSAGE);
      expect(updates).toEqual([]);
    });

    it('needs leads.edit to edit and leads.create to create, and nothing else changed about 404', async () => {
      user = { id: 'user-1', permissions: ['leads.view'] };
      expect((await edit({ city: null })).status).toBe(403);
      expect((await create()).status).toBe(403);
      user = { id: 'user-1', permissions: ALL };
      expect(
        (
          await edit(
            { customerName: 'x' },
            '33333333-3333-4333-8333-333333333333',
          )
        ).status,
      ).toBe(404);
    });
  });

  describe('where location is and is not written', () => {
    const src = (rel: string) =>
      fs.readFileSync(path.join(__dirname, '../../..', rel), 'utf8');

    it('is written by the lead service only: not by the WhatsApp bot, the webhook importer, status or assignment', () => {
      for (const rel of [
        'core/whatsapp/whatsapp.service.ts',
        'modules/adminos/webhooks/webhooks.service.ts',
        'modules/revenueos/lead-status/lead-status.service.ts',
        'modules/revenueos/lead-assignments/lead-assignments.service.ts',
      ]) {
        expect(src(rel)).not.toMatch(/\b(country|state|city)\s*:/);
      }
      expect(src('modules/revenueos/leads/leads.service.ts')).toMatch(
        /country: location\.country/,
      );
    });

    it('never derives a country from a phone number', () => {
      const service = src('modules/revenueos/leads/leads.service.ts');
      const location = src('modules/revenueos/leads/lead-location.ts');
      for (const text of [service, location]) {
        expect(text).not.toMatch(
          /\bphone\b.*\bcountry\b|\bcountry\b.*\.phone|callingCode|dialCode|libphonenumber/i,
        );
      }
    });
  });
});

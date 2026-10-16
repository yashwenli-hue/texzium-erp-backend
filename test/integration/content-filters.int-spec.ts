/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- supertest response bodies are loosely typed */
import { Ctx, reset, role, startApp, stopApp, user } from './harness';

// Content-library filters for sharing: by the product category of the linked inventory
// item, by tag, by kind. No file is stored and nothing is shared here.

let ctx: Ctx;
let viewer: string;

beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => stopApp(ctx));
beforeEach(async () => {
  await reset(ctx.db);
  const r = await role(ctx.db, 'SALES', ['content.view']);
  viewer = (await user(ctx.db, 'Vik Viewer', r.id)).id;
  const loom = await ctx.db.inventoryItem.create({
    data: {
      sku: 'NL-10',
      productName: 'Needle Loom 10/27G',
      category: 'Needle Looms',
      stockQty: 1,
      availableQty: 1,
    },
  });
  const braider = await ctx.db.inventoryItem.create({
    data: {
      sku: 'BR-32',
      productName: '32/2 Braiding Machine',
      category: 'Braiding Machines',
      stockQty: 1,
      availableQty: 1,
    },
  });
  await ctx.db.contentAsset.create({
    data: {
      title: 'Loom brochure',
      kind: 'CATALOGUE',
      inventoryItemId: loom.id,
      tags: ['loom'],
    },
  });
  await ctx.db.contentAsset.create({
    data: { title: 'Loom video', kind: 'VIDEO', inventoryItemId: loom.id },
  });
  await ctx.db.contentAsset.create({
    data: {
      title: 'Braider brochure',
      kind: 'CATALOGUE',
      inventoryItemId: braider.id,
      tags: ['braiding'],
    },
  });
  await ctx.db.contentAsset.create({
    data: { title: 'Company profile', kind: 'CATALOGUE' },
  });
});

const titles = (r: { body: Array<{ title: string }> }) =>
  r.body.map((a) => a.title).sort();

it('filters by the product category of the linked item, case-insensitively', async () => {
  expect(
    titles(await ctx.as(viewer).get('/content-assets?category=needle%20looms')),
  ).toEqual(['Loom brochure', 'Loom video']);
  expect(
    titles(
      await ctx
        .as(viewer)
        .get('/content-assets?category=Braiding%20Machines&kind=CATALOGUE'),
    ),
  ).toEqual(['Braider brochure']);
  expect(
    (await ctx.as(viewer).get('/content-assets?category=Pumps')).body,
  ).toEqual([]);
});

it("shows each item's category, for the category choices", async () => {
  const all = await ctx.as(viewer).get('/content-assets');
  const loom = all.body.find(
    (a: { title: string }) => a.title === 'Loom video',
  );
  expect(loom.inventoryItem).toMatchObject({
    sku: 'NL-10',
    productName: 'Needle Loom 10/27G',
    category: 'Needle Looms',
  });
  expect(
    all.body.find((a: { title: string }) => a.title === 'Company profile')
      .inventoryItem,
  ).toBeNull();
});

it('still filters by tag and kind', async () => {
  expect(
    titles(await ctx.as(viewer).get('/content-assets?tag=braiding')),
  ).toEqual(['Braider brochure']);
  expect(
    titles(await ctx.as(viewer).get('/content-assets?kind=VIDEO')),
  ).toEqual(['Loom video']);
});

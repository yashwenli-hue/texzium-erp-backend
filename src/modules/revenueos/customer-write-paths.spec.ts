import * as fs from 'fs';
import * as path from 'path';

// The Customer master is written by the customer service, and by one other
// place that is known and recorded: the vendor flow, which creates a customer
// for a vendor that is also a customer. These specs keep that list from
// growing unnoticed. A new writer has to be added here on purpose.

const SRC = path.resolve(__dirname, '../..');

const CUSTOMER_SERVICE =
  'modules/revenueos/customer-master/customer-master.service.ts';
const VENDOR_FLOW = 'modules/operationsos/vendors/vendors.service.ts';
const GST_SERVICE = 'modules/revenueos/customer-gst/customer-gst.service.ts';

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [full] : [];
  });

const WRITES =
  '(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)';

// Every way the code could write a Customer row: a direct write, a nested write
// from a parent, a raw statement, or a model reached through a computed name.
const WRITES_A_CUSTOMER = [
  new RegExp(String.raw`\.customer\s*\.\s*${WRITES}\b`),
  /\bcustomer\s*:\s*\{\s*(create|createMany|connectOrCreate|update|upsert|delete)\b/,
  /INSERT\s+INTO\s+"?Customer"?(\s|\()/i,
  /UPDATE\s+"?Customer"?\s+SET\b/i,
  /DELETE\s+FROM\s+"?Customer"?(\s|;|`|'|$)/i,
  /\[\s*['"`]customer['"`]\s*\]/,
  /(prisma|tx|this\.prisma)\s*\[[^\]]+\]\s*\.\s*(create|createMany|upsert|update|delete)\b/,
];

const WRITES_A_REGISTRATION = [
  new RegExp(String.raw`\.customerGSTRegistration\s*\.\s*${WRITES}\b`),
  /\bgstRegistrations\s*:\s*\{\s*(create|createMany|connectOrCreate|update|upsert|delete)\b/,
  /INSERT\s+INTO\s+"?CustomerGSTRegistration"?(\s|\()/i,
  /UPDATE\s+"?CustomerGSTRegistration"?\s+SET\b/i,
];

const writersOf = (patterns: RegExp[]) => {
  const writers: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');

    if (patterns.some((re) => re.test(text))) writers.push(rel);
  }

  return writers.sort();
};

// Governed deletion and restore (see customer-deletion.policy.ts) is the one deliberate
// addition: it deletes a customer and its registrations after the blockers have been
// checked under a lock, and recreates them from the tombstone on restore.
const CUSTOMER_DELETION =
  'modules/revenueos/customer-master/customer-deletion.policy.ts';

describe('Customer write paths', () => {
  it('only the customer service and the vendor flow write a Customer row', () => {
    expect(writersOf(WRITES_A_CUSTOMER)).toEqual(
      [CUSTOMER_SERVICE, VENDOR_FLOW, CUSTOMER_DELETION].sort(),
    );
  });

  it('the vendor flow only ever creates a customer; it never edits or removes one', () => {
    const text = fs.readFileSync(path.join(SRC, VENDOR_FLOW), 'utf8');

    expect(text).toMatch(/\.customer\s*\.\s*create\b/);
    expect(text).not.toMatch(
      /\.customer\s*\.\s*(createMany|update|updateMany|upsert|delete|deleteMany)\b/,
    );
  });

  it('the customer service never deletes a customer', () => {
    const text = fs.readFileSync(path.join(SRC, CUSTOMER_SERVICE), 'utf8');

    expect(text).not.toMatch(/\.customer\s*\.\s*(delete|deleteMany)\b/);
    expect(text).not.toMatch(/DELETE\s+FROM/i);
  });

  it('only the GST registration service, customer creation (the first registration of a new customer, in the same transaction) and governed deletion / restore write a registration', () => {
    expect(writersOf(WRITES_A_REGISTRATION)).toEqual(
      [GST_SERVICE, CUSTOMER_SERVICE, CUSTOMER_DELETION].sort(),
    );
  });

  it('governed deletion is the only place a customer or a registration is removed, and it removes only the one customer it was asked to', () => {
    const text = fs.readFileSync(path.join(SRC, CUSTOMER_DELETION), 'utf8');

    expect(text).toMatch(/customer\.delete\(\{ where: \{ id \} \}\)/);
    expect(text).toMatch(
      /customerGSTRegistration\.deleteMany\(\{ where: \{ customerId: id \} \}\)/,
    );
    expect(text).toMatch(
      /customerEvent\.deleteMany\(\{ where: \{ customerId: id \} \}\)/,
    );
    expect(text).not.toMatch(
      /customer\.(deleteMany|updateMany|update|upsert)\b/,
    );
    expect(text).not.toMatch(/DELETE\s+FROM/i);
  });

  it('only the opportunity service writes an Opportunity row, so only it can set the customer', () => {
    const WRITES_AN_OPPORTUNITY = [
      new RegExp(String.raw`\.opportunity\s*\.\s*${WRITES}\b`),
      /\bopportunities\s*:\s*\{\s*(create|createMany|connectOrCreate|update|upsert|delete)\b/,
      /INSERT\s+INTO\s+"?Opportunity"?(\s|\()/i,
      /UPDATE\s+"?Opportunity"?\s+SET\b/i,
    ];

    expect(writersOf(WRITES_AN_OPPORTUNITY)).toEqual([
      'modules/revenueos/opportunities/opportunities.service.ts',
    ]);
  });

  it('catches each way of writing a customer (the scan is not blind)', () => {
    const samples = [
      'await this.prisma.customer.create({})',
      'await tx.customer\n .update({})',
      'prisma.customer.upsert({})',
      'await tx.customer.deleteMany({})',
      'vendor.update({ data: { customer: { create: {} } } })',
      'await prisma.$executeRaw`INSERT INTO "Customer" ("id") VALUES (1)`',
      'await prisma.$executeRaw`UPDATE "Customer" SET "isActive" = false`',
      'await prisma.$executeRaw`DELETE FROM "Customer"`',
      "const m = prisma['customer']",
      'await tx[model].update({})',
    ];

    for (const sample of samples) {
      expect([sample, WRITES_A_CUSTOMER.some((re) => re.test(sample))]).toEqual(
        [sample, true],
      );
    }

    for (const innocent of [
      'await this.prisma.customer.findMany({})',
      'await tx.customer.findUniqueOrThrow({})',
      'await tx.customerEvent.create({})',
      'await tx.customerGSTRegistration.create({})',
      'SELECT "isActive" FROM "Customer" WHERE "id" = $1 FOR UPDATE',
      'INSERT INTO "CustomerEvent" ("id")',
    ]) {
      expect([
        innocent,
        WRITES_A_CUSTOMER.some((re) => re.test(innocent)),
      ]).toEqual([innocent, false]);
    }
  });

  it('catches each way of writing a registration', () => {
    for (const sample of [
      'await this.prisma.customerGSTRegistration.create({})',
      'tx.customerGSTRegistration.updateMany({})',
      'customer.update({ data: { gstRegistrations: { create: {} } } })',
      'INSERT INTO "CustomerGSTRegistration" ("id")',
    ]) {
      expect([
        sample,
        WRITES_A_REGISTRATION.some((re) => re.test(sample)),
      ]).toEqual([sample, true]);
    }
  });
});

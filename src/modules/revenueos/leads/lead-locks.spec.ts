/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import { ConflictException, NotFoundException } from '@nestjs/common';

import {
  LEAD_DEACTIVATED_MESSAGE,
  lockActiveLeadForUpdate,
  lockActiveLeadForWrite,
  lockLeadForDeactivation,
  lockLeadForWrite,
} from './lead-lifecycle';

// The row locks every writer of a lead takes, and which kind each takes. The kind is the
// point: a writer that UPDATES the lead row must take FOR NO KEY UPDATE up front (taking
// FOR SHARE and then updating is a lock upgrade, and two of them on one lead deadlock,
// as a race on a real database showed), and a deletion or deactivation takes FOR UPDATE.
// The behaviour under real contention is proven on a scratch database.

const tx = (rows: unknown[]) => {
  const sql: string[] = [];
  return {
    sql,
    tx: {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        sql.push(strings.join('?'));
        return rows;
      }),
    } as any,
  };
};

describe('lead row locks', () => {
  it('a deactivation or deletion takes FOR UPDATE and a missing lead is a 404', async () => {
    const found = tx([{ id: 'L' }]);
    await lockLeadForDeactivation(found.tx, 'L');
    expect(found.sql[0]).toContain('FOR UPDATE');
    expect(found.sql[0]).not.toContain('NO KEY');

    await expect(
      lockLeadForDeactivation(tx([]).tx, 'L'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a writer that adds rows to the lead (follow-up, opportunity) takes FOR SHARE, and the lead must be active', async () => {
    const ok = tx([{ isActive: true }]);
    await lockActiveLeadForWrite(ok.tx, 'L');
    expect(ok.sql[0]).toContain('FOR SHARE');

    await expect(lockActiveLeadForWrite(tx([]).tx, 'L')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      lockActiveLeadForWrite(tx([{ isActive: false }]).tx, 'L'),
    ).rejects.toThrow(LEAD_DEACTIVATED_MESSAGE);
  });

  it('a change to an existing follow-up takes FOR SHARE on the lead whether or not it is active', async () => {
    const inactive = tx([{ id: 'L' }]);
    await lockLeadForWrite(inactive.tx, 'L');
    expect(inactive.sql[0]).toContain('FOR SHARE');
    await expect(
      lockLeadForWrite(tx([]).tx, 'L', 'Lead not found'),
    ).rejects.toThrow('Lead not found');
  });

  it('a writer that UPDATES the lead row takes FOR NO KEY UPDATE straight away (never FOR SHARE first), and the lead must be active', async () => {
    const ok = tx([{ isActive: true }]);
    await lockActiveLeadForUpdate(ok.tx, 'L');
    expect(ok.sql).toHaveLength(1);
    expect(ok.sql[0]).toContain('FOR NO KEY UPDATE');
    expect(ok.sql[0]).not.toContain('FOR SHARE');

    await expect(
      lockActiveLeadForUpdate(tx([]).tx, 'L'),
    ).rejects.toBeInstanceOf(NotFoundException);
    const inactive = lockActiveLeadForUpdate(tx([{ isActive: false }]).tx, 'L');
    await expect(inactive).rejects.toBeInstanceOf(ConflictException);
    await expect(inactive).rejects.toThrow(LEAD_DEACTIVATED_MESSAGE);
  });

  it('keeps the message the caller gives for a missing lead', async () => {
    await expect(
      lockActiveLeadForUpdate(tx([]).tx, 'L', 'Nothing here'),
    ).rejects.toThrow('Nothing here');
  });
});

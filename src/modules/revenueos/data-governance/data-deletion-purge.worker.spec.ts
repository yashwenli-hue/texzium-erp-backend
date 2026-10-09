/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import { Logger } from '@nestjs/common';

import {
  AUTO_PURGE_DEFAULTS,
  DataDeletionPurgeWorker,
  PurgeWorkerOptions,
  readPurgeWorkerOptions,
} from './data-deletion-purge.worker';
import type { AutoPurgeOutcome } from './data-deletion';

// The purge worker with a fake service: scheduling (fake timers, no sleeping), paging,
// bounds, failure and retry, overlapping runs, several workers at once, shutdown and what
// is (and is not) logged. What one purge does to the database is in
// data-deletion.service.spec.ts and in the scratch-database scripts.

interface Row {
  id: string;
  entityType: 'LEAD' | 'CUSTOMER';
  purgeAfter: Date;
}

const rows = (n: number, start = 0): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t-${String(start + i).padStart(5, '0')}`,
    entityType: i % 2 === 0 ? 'LEAD' : 'CUSTOMER',
    purgeAfter: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
  }));

// A fake of the two service methods the worker uses, over an in-memory list. `purgeExpired`
// mimics the real one: a purged row leaves the list of expired ones.
function fakeService(initial: Row[]) {
  const pending = new Map(initial.map((r) => [r.id, r]));
  const purged: string[] = [];
  const held = new Set<string>(); // ids another transaction holds
  const failing = new Map<string, Error>();
  let findError: Error | undefined;
  const calls = {
    find: [] as Array<{ limit: number; after?: Row }>,
    purge: [] as string[],
  };

  const service: any = {
    findExpiredTombstones: jest.fn(async (limit: number, after?: Row) => {
      calls.find.push({ limit, after });
      if (findError) throw findError;
      return [...pending.values()]
        .sort(
          (a, b) =>
            a.purgeAfter.getTime() - b.purgeAfter.getTime() ||
            a.id.localeCompare(b.id),
        )
        .filter(
          (r) =>
            !after ||
            r.purgeAfter > after.purgeAfter ||
            (r.purgeAfter.getTime() === after.purgeAfter.getTime() &&
              r.id > after.id),
        )
        .slice(0, limit);
    }),
    purgeExpired: jest.fn(async (id: string): Promise<AutoPurgeOutcome> => {
      calls.purge.push(id);
      await Promise.resolve();
      const error = failing.get(id);
      if (error) throw error;
      if (held.has(id)) return 'LOCKED';
      if (!pending.has(id)) return 'NOT_DELETED';
      held.add(id); // the row lock, for the length of this "transaction"
      await Promise.resolve();
      pending.delete(id);
      purged.push(id);
      held.delete(id);
      return 'PURGED';
    }),
  };

  return {
    service,
    pending,
    purged,
    held,
    calls,
    fail: (id: string, error: Error) => failing.set(id, error),
    heal: (id: string) => failing.delete(id),
    failFind: (error: Error | undefined) => (findError = error),
  };
}

// The logger would print every line of every test: silence it (the tests that look at the
// lines spy on the logger's methods themselves).
beforeAll(() => Logger.overrideLogger(false));
afterAll(() => Logger.overrideLogger(['log', 'warn', 'error']));

const FIXED_NOW = new Date('2026-12-31T12:00:00.000Z');

const make = (
  service: any,
  options: Partial<PurgeWorkerOptions> = {},
): DataDeletionPurgeWorker =>
  new DataDeletionPurgeWorker(service, {
    enabled: true,
    intervalMs: 60 * 60 * 1000,
    firstRunDelayMs: 90 * 1000,
    random: () => 0.5, // no jitter
    now: () => FIXED_NOW,
    ...options,
  });

describe('readPurgeWorkerOptions', () => {
  it('defaults: on, hourly, first run after 90 seconds, pages of 50, at most 20 pages a run', () => {
    const o = readPurgeWorkerOptions({});
    expect(o.enabled).toBe(true);
    expect(o.intervalMs).toBe(60 * 60 * 1000);
    expect(o.firstRunDelayMs).toBe(90 * 1000);
    expect(o.batchSize).toBe(50);
    expect(o.maxBatchesPerRun).toBe(20);
    expect(o.maxConsecutiveFailures).toBe(5);
    expect(
      AUTO_PURGE_DEFAULTS.batchSize * AUTO_PURGE_DEFAULTS.maxBatchesPerRun,
    ).toBe(1000);
  });

  it.each(['off', 'OFF', 'false', '0', 'no', ' off '])(
    'DATA_DELETION_AUTOPURGE=%j turns it off',
    (value) => {
      expect(
        readPurgeWorkerOptions({ DATA_DELETION_AUTOPURGE: value }).enabled,
      ).toBe(false);
    },
  );

  it.each(['on', 'true', '1', ''])(
    'DATA_DELETION_AUTOPURGE=%j leaves it on',
    (value) => {
      expect(
        readPurgeWorkerOptions({ DATA_DELETION_AUTOPURGE: value }).enabled,
      ).toBe(true);
    },
  );

  it('takes the interval and the first-run delay from the environment, and falls back for nonsense or out-of-range values', () => {
    const set = readPurgeWorkerOptions({
      DATA_DELETION_AUTOPURGE_INTERVAL_MINUTES: '15',
      DATA_DELETION_AUTOPURGE_FIRST_RUN_SECONDS: '5',
    });
    expect(set.intervalMs).toBe(15 * 60 * 1000);
    expect(set.firstRunDelayMs).toBe(5000);
    for (const bad of ['0', '-3', '1441', 'abc', 'NaN']) {
      expect(
        readPurgeWorkerOptions({
          DATA_DELETION_AUTOPURGE_INTERVAL_MINUTES: bad,
        }).intervalMs,
      ).toBe(60 * 60 * 1000);
    }
  });
});

describe('one run', () => {
  it('purges everything that is due, one record at a time, in pages of the batch size, oldest deadline first', async () => {
    const f = fakeService(rows(120));
    const worker = make(f.service, { batchSize: 50, maxBatchesPerRun: 20 });
    const summary = await worker.runOnce();

    expect(summary).toMatchObject({
      started: true,
      purged: 120,
      failed: 0,
      batches: 3,
      stoppedBy: 'DONE',
    });
    expect(f.purged).toEqual(rows(120).map((r) => r.id));
    expect(f.calls.find.map((c) => c.limit)).toEqual([50, 50, 50]);
    expect(f.pending.size).toBe(0);
  });

  it('pages with a cursor (the last row of the page), so a page is never repeated or skipped', async () => {
    const f = fakeService(rows(7));
    await make(f.service, { batchSize: 3 }).runOnce();
    const cursors = f.calls.find.map((c) => c.after?.id);
    expect(cursors).toEqual([undefined, 't-00002', 't-00005']);
  });

  it('does nothing, and says so, when nothing is due', async () => {
    const f = fakeService([]);
    const summary = await make(f.service).runOnce();
    expect(summary).toMatchObject({ purged: 0, batches: 0, stoppedBy: 'DONE' });
    expect(f.service.purgeExpired).not.toHaveBeenCalled();
  });

  it('is bounded: at most batchSize x maxBatchesPerRun records a run; the rest wait for the next run', async () => {
    const f = fakeService(rows(500));
    const worker = make(f.service, { batchSize: 50, maxBatchesPerRun: 2 });

    const first = await worker.runOnce();
    expect(first).toMatchObject({
      purged: 100,
      batches: 2,
      stoppedBy: 'BATCH_LIMIT',
    });
    expect(f.pending.size).toBe(400);

    const second = await worker.runOnce();
    expect(second.purged).toBe(100);
    expect(f.pending.size).toBe(300);
  });

  it('never holds more than one page of ids: every page is at most the batch size', async () => {
    const f = fakeService(rows(333));
    await make(f.service, { batchSize: 25, maxBatchesPerRun: 100 }).runOnce();
    expect(Math.max(...f.calls.find.map((c) => c.limit))).toBe(25);
    for (
      let i = 0;
      i < f.service.findExpiredTombstones.mock.results.length;
      i++
    ) {
      const page = await f.service.findExpiredTombstones.mock.results[i].value;
      expect(page.length).toBeLessThanOrEqual(25);
    }
  });

  it('counts what it found under the lock: held by somebody (left for later), already gone, not due', async () => {
    const f = fakeService(rows(4));
    f.held.add('t-00001');
    f.service.purgeExpired.mockImplementation(async (id: string) => {
      if (id === 't-00001') return 'LOCKED';
      if (id === 't-00002') return 'NOT_DELETED';
      if (id === 't-00003') return 'NOT_DUE';
      return 'PURGED';
    });
    const summary = await make(f.service).runOnce();
    expect(summary).toMatchObject({
      purged: 1,
      locked: 1,
      notDeleted: 1,
      notDue: 1,
      failed: 0,
    });
  });

  it('a record held by a restore this time is simply picked up by the next run, if it is still due', async () => {
    const f = fakeService(rows(2));
    f.held.add('t-00000'); // a restore (or another worker) holds it
    const worker = make(f.service);
    const first = await worker.runOnce();
    expect(first).toMatchObject({ purged: 1, locked: 1 });
    expect(f.pending.has('t-00000')).toBe(true);

    f.held.delete('t-00000'); // the other transaction ended without touching it
    const second = await worker.runOnce();
    expect(second.purged).toBe(1);
    expect(f.pending.size).toBe(0);
  });

  it('a record restored in the meantime is never purged: the service says NOT_DELETED and the worker moves on', async () => {
    const f = fakeService(rows(3));
    f.pending.delete('t-00001'); // restored after the page was read
    f.service.findExpiredTombstones.mockImplementationOnce(async () => rows(3));
    const summary = await make(f.service).runOnce();
    expect(summary).toMatchObject({ purged: 2, notDeleted: 1 });
    expect(f.purged).toEqual(['t-00000', 't-00002']);
  });
});

describe('failures and retries', () => {
  it('a record whose purge fails stays unpurged and is counted; the others are still purged', async () => {
    const f = fakeService(rows(5));
    f.fail('t-00002', new Error('deadlock detected'));
    const summary = await make(f.service).runOnce();
    expect(summary).toMatchObject({ purged: 4, failed: 1, stoppedBy: 'DONE' });
    expect(f.pending.has('t-00002')).toBe(true);
    expect(f.purged).not.toContain('t-00002');
  });

  it('retries it on the next run, and it is then purged exactly once', async () => {
    const f = fakeService(rows(3));
    f.fail('t-00001', new Error('connection reset'));
    const worker = make(f.service);
    await worker.runOnce();
    expect(f.pending.size).toBe(1);

    f.heal('t-00001');
    const second = await worker.runOnce();
    expect(second).toMatchObject({ purged: 1, failed: 0 });
    expect(f.purged.filter((id) => id === 't-00001')).toHaveLength(1);
    expect(f.pending.size).toBe(0);
  });

  it('stops the run after repeated failures in a row (the database is probably away) instead of trying every record', async () => {
    const f = fakeService(rows(100));
    for (const r of rows(100)) f.fail(r.id, new Error('db down'));
    const summary = await make(f.service, {
      maxConsecutiveFailures: 5,
    }).runOnce();
    expect(summary).toMatchObject({
      failed: 5,
      purged: 0,
      stoppedBy: 'FAILURES',
    });
    expect(f.service.purgeExpired).toHaveBeenCalledTimes(5);
  });

  it('a success resets the count of failures in a row', async () => {
    const f = fakeService(rows(12));
    for (const id of [
      't-00000',
      't-00001',
      't-00002',
      't-00003',
      't-00005',
      't-00006',
      't-00007',
      't-00008',
    ]) {
      f.fail(id, new Error('x'));
    }
    const summary = await make(f.service, {
      maxConsecutiveFailures: 5,
    }).runOnce();
    expect(summary.stoppedBy).toBe('DONE');
    expect(summary.failed).toBe(8);
    expect(summary.purged).toBe(4);
  });

  it('a failure to read a page ends the run, counted as a failure, and nothing is purged', async () => {
    const f = fakeService(rows(3));
    f.failFind(new Error('cannot read'));
    const summary = await make(f.service).runOnce();
    expect(summary).toMatchObject({
      failed: 1,
      purged: 0,
      stoppedBy: 'FAILURES',
    });
  });

  it('a missing tombstone table (P2021: the migration is not applied yet) is a quiet UNAVAILABLE, logged as a warning, never a crash', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const f = fakeService(rows(3));
    f.failFind(
      Object.assign(new Error('table does not exist'), { code: 'P2021' }),
    );
    const summary = await make(f.service).runOnce();
    expect(summary.stoppedBy).toBe('UNAVAILABLE');
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('never rejects: even an unexpected error is counted and the run ends', async () => {
    const f = fakeService(rows(2));
    f.service.findExpiredTombstones.mockImplementation(() => {
      throw new TypeError('boom');
    });
    await expect(make(f.service).runOnce()).resolves.toMatchObject({
      failed: 1,
    });
  });
});

describe('runs never overlap, and several workers share the work', () => {
  it('a second run started while one is in flight does not start: the service is not asked twice', async () => {
    const f = fakeService(rows(3));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = f.service.purgeExpired.getMockImplementation()!;
    f.service.purgeExpired.mockImplementation(async (id: string) => {
      await gate;
      return original(id);
    });
    const worker = make(f.service);

    const first = worker.runOnce();
    const second = await worker.runOnce();
    expect(second).toMatchObject({ started: false, purged: 0 });

    release();
    expect(await first).toMatchObject({ started: true, purged: 3 });
    expect(f.service.findExpiredTombstones).toHaveBeenCalledTimes(1);

    // and once it has ended, the next one starts normally
    expect((await worker.runOnce()).started).toBe(true);
  });

  it('many callers at once start exactly one run', async () => {
    const f = fakeService(rows(20));
    const worker = make(f.service);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => worker.runOnce()),
    );
    expect(results.filter((r) => r.started)).toHaveLength(1);
    expect(f.purged).toHaveLength(20);
  });

  it('two workers (two instances) on one backlog purge every record exactly once between them', async () => {
    const f = fakeService(rows(200));
    const a = make(f.service, { batchSize: 10 });
    const b = make(f.service, { batchSize: 10 });
    const [ra, rb] = await Promise.all([a.runOnce(), b.runOnce()]);

    expect(f.purged).toHaveLength(200);
    expect(new Set(f.purged).size).toBe(200);
    expect(ra.purged + rb.purged).toBe(200);
    expect(ra.failed + rb.failed).toBe(0);
    expect(f.pending.size).toBe(0);
  });

  it('five workers on one backlog: still exactly once each', async () => {
    const f = fakeService(rows(100));
    const workers = Array.from({ length: 5 }, () =>
      make(f.service, { batchSize: 7 }),
    );
    const all = await Promise.all(workers.map((w) => w.runOnce()));
    expect(new Set(f.purged).size).toBe(100);
    expect(f.purged).toHaveLength(100);
    expect(all.reduce((n, r) => n + r.purged, 0)).toBe(100);
  });

  it('running it again after everything is purged does nothing', async () => {
    const f = fakeService(rows(10));
    const worker = make(f.service);
    await worker.runOnce();
    const again = await worker.runOnce();
    expect(again).toMatchObject({ purged: 0, batches: 0 });
    expect(f.purged).toHaveLength(10);
  });
});

describe('what it logs', () => {
  let lines: Array<{ level: string; line: string }>;

  beforeEach(() => {
    lines = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((message: unknown) => {
          lines.push({ level, line: String(message) });
        });
    }
  });

  afterEach(() => jest.restoreAllMocks());

  const events = () =>
    lines.map((l) => ({ level: l.level, ...JSON.parse(l.line) }));

  it('one JSON line per event: start, each purge as a system action with its timestamp, and the outcome of the run', async () => {
    const f = fakeService(rows(2));
    await make(f.service).runOnce();

    const names = events().map((e) => e.event);
    expect(names).toEqual([
      'data_deletion.auto_purge.run_started',
      'data_deletion.auto_purge.record_purged',
      'data_deletion.auto_purge.record_purged',
      'data_deletion.auto_purge.run_finished',
    ]);
    const purged = events().filter((e) => e.event.endsWith('record_purged'));
    expect(purged[0]).toEqual({
      level: 'log',
      event: 'data_deletion.auto_purge.record_purged',
      at: FIXED_NOW.toISOString(),
      tombstoneId: 't-00000',
      entityType: 'LEAD',
      purgeAfter: '2026-01-01T00:00:00.000Z',
      purgedAt: FIXED_NOW.toISOString(),
      actor: 'system',
    });
    expect(purged[1].entityType).toBe('CUSTOMER');
    const finished = events().find((e) => e.event.endsWith('run_finished'));
    expect(finished).toMatchObject({
      batches: 1,
      purged: 2,
      failed: 0,
      stoppedBy: 'DONE',
    });
  });

  it('a failure is logged with the tombstone id, the error class and code, and NOT the error message (which may quote data)', async () => {
    const f = fakeService(rows(2));
    const secret =
      'Sterling Pumps Pvt Ltd, +91 98220 41120, ZEBRA-REASON, procurement@sterlingpumps.in';
    f.fail(
      't-00001',
      Object.assign(new Error(`Unique constraint failed on ${secret}`), {
        code: 'P2002',
      }),
    );
    await make(f.service).runOnce();

    const failed = events().find(
      (e) => e.event === 'data_deletion.auto_purge.failed',
    );
    expect(failed).toMatchObject({
      level: 'error',
      kind: 'RECORD_FAILED',
      tombstoneId: 't-00001',
      errorClass: 'Error',
      errorCode: 'P2002',
    });
    const all = lines.map((l) => l.line).join('\n');
    expect(all).not.toContain('Sterling');
    expect(all).not.toContain('ZEBRA');
    expect(all).not.toContain('98220');
    expect(all).not.toContain('sterlingpumps');
    expect(all).not.toContain('Unique constraint');
  });

  it('carries no label, name, reason, snapshot or contact data in any line, even when the rows it was given carry them', async () => {
    const f = fakeService(rows(3));
    f.service.findExpiredTombstones.mockImplementationOnce(async () =>
      rows(3).map((r) => ({
        ...r,
        entityLabel: 'Sterling Pumps',
        reason: 'ZEBRA-REASON',
        snapshot: { lead: { phone: '+91 98220 41120', email: 'x@y.in' } },
      })),
    );
    await make(f.service).runOnce();
    const text = lines.map((l) => l.line).join('\n');
    for (const forbidden of [
      'Sterling',
      'ZEBRA',
      '98220',
      'x@y.in',
      'entityLabel',
      'reason',
      'snapshot',
      'label',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    for (const e of events()) {
      expect(Object.keys(e).sort()).toEqual(
        expect.arrayContaining(['event', 'at']),
      );
    }
  });

  it('a run that had failures finishes as a warning, a clean one as info', async () => {
    const f = fakeService(rows(2));
    f.fail('t-00000', new Error('x'));
    await make(f.service).runOnce();
    expect(events().find((e) => e.event.endsWith('run_finished'))!.level).toBe(
      'warn',
    );

    lines.length = 0;
    await make(fakeService(rows(1)).service).runOnce();
    expect(events().find((e) => e.event.endsWith('run_finished'))!.level).toBe(
      'log',
    );
  });

  it('a run that was skipped because another was running says so (once)', async () => {
    const f = fakeService(rows(1));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = f.service.purgeExpired.getMockImplementation()!;
    f.service.purgeExpired.mockImplementation(async (id: string) => {
      await gate;
      return original(id);
    });
    const worker = make(f.service);
    const first = worker.runOnce();
    await worker.runOnce();
    release();
    await first;
    expect(
      events().filter((e) => e.event.endsWith('run_skipped')),
    ).toHaveLength(1);
  });
});

describe('scheduling and shutdown (fake timers)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not run at start-up: the first run is after the first-run delay, then every interval, each scheduled when the previous one has ended', async () => {
    const f = fakeService(rows(2));
    const worker = make(f.service, {
      firstRunDelayMs: 90_000,
      intervalMs: 3_600_000,
    });
    worker.onApplicationBootstrap();

    expect(f.service.findExpiredTombstones).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(89_999);
    expect(f.service.findExpiredTombstones).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(f.purged).toHaveLength(2);
    const afterFirst = f.service.findExpiredTombstones.mock.calls.length;

    f.pending.set('late', {
      id: 'late',
      entityType: 'LEAD',
      purgeAfter: new Date(0),
    });
    await jest.advanceTimersByTimeAsync(3_599_999);
    expect(f.service.findExpiredTombstones.mock.calls.length).toBe(afterFirst);
    await jest.advanceTimersByTimeAsync(1);
    expect(f.purged).toContain('late');

    await worker.onModuleDestroy();
  });

  it('adds +-10% jitter to every delay (so instances started together do not wake together)', async () => {
    const f = fakeService([]);
    const low = make(f.service, { firstRunDelayMs: 100_000, random: () => 0 });
    low.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(89_999);
    expect(f.service.findExpiredTombstones).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(f.service.findExpiredTombstones).toHaveBeenCalledTimes(1);
    await low.onModuleDestroy();

    f.service.findExpiredTombstones.mockClear();
    const high = make(f.service, { firstRunDelayMs: 100_000, random: () => 1 });
    high.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(109_999);
    expect(f.service.findExpiredTombstones).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(f.service.findExpiredTombstones).toHaveBeenCalledTimes(1);
    await high.onModuleDestroy();
  });

  it('when turned off it schedules nothing at all', async () => {
    const f = fakeService(rows(2));
    const worker = make(f.service, { enabled: false });
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(f.service.findExpiredTombstones).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a run that is slower than the interval is not overlapped by the next timer: the next run is scheduled only after it ends', async () => {
    const f = fakeService(rows(1));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = f.service.purgeExpired.getMockImplementation()!;
    f.service.purgeExpired.mockImplementation(async (id: string) => {
      await gate;
      return original(id);
    });
    const worker = make(f.service, {
      firstRunDelayMs: 1000,
      intervalMs: 60_000,
    });
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(1000); // first run starts and waits on the gate
    await jest.advanceTimersByTimeAsync(10 * 60_000); // ten intervals pass while it waits
    expect(f.service.findExpiredTombstones).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0); // nothing queued behind it

    release();
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(1); // now the next one is scheduled
    await worker.onModuleDestroy();
  });

  it('shutdown stops the timer: no run after it, and no timer left behind', async () => {
    const f = fakeService(rows(2));
    const worker = make(f.service);
    worker.onApplicationBootstrap();
    expect(jest.getTimerCount()).toBe(1);
    await worker.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(f.service.findExpiredTombstones).not.toHaveBeenCalled();
  });

  it('shutdown while a run is in flight waits for the record it is on, purges no further record, and schedules nothing', async () => {
    const f = fakeService(rows(10));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = f.service.purgeExpired.getMockImplementation()!;
    let started = 0;
    f.service.purgeExpired.mockImplementation(async (id: string) => {
      started += 1;
      if (started === 3) await gate; // the third record is "mid transaction"
      return original(id);
    });
    const worker = make(f.service, { firstRunDelayMs: 10 });
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(10);
    await Promise.resolve();

    const closing = worker.onModuleDestroy();
    release();
    await closing;

    expect(f.purged).toEqual(['t-00000', 't-00001', 't-00002']); // the third finished, nothing after it
    expect(f.service.purgeExpired).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
  });
});

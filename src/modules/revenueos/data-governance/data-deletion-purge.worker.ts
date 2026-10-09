import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';

import { DataDeletionService } from './data-deletion.service';

// Automatic purge of the recycle bin.
//
// A record that nobody restored (and no administrator purged) is erased for good once its
// recovery window has ended: this worker finds the tombstones that are still DELETED and
// whose STORED deadline (purgeAfter, fixed when the record was deleted) has passed, and
// purges each one as a system action (purgeMethod AUTOMATIC, no actor).
//
// Design, in one place:
//
//  * No new dependency and no queue: the backend has no scheduler package, and BullMQ would
//    need Redis for a job that is one SQL statement per record. A plain timer inside the
//    Nest lifecycle is enough, because the coordination is in the database.
//  * One run every INTERVAL (hourly by default), the first one shortly after start-up. The
//    next run is scheduled when the previous one ends (a chain of single timeouts, never an
//    interval), and `runOnce` also refuses to start while a run is in flight: runs of one
//    process never overlap.
//  * Bounded work: a run looks at pages of BATCH_SIZE tombstones, at most MAX_BATCHES pages
//    (BATCH_SIZE x MAX_BATCHES records). A bigger backlog is simply finished by the next
//    runs. Every record is purged in its own short transaction, so nothing here is ever one
//    big transaction, and only one page of ids is in memory.
//  * Safe with several instances, and with restores and manual purges: each record is taken
//    with SELECT ... FOR UPDATE SKIP LOCKED and judged again under that lock (still DELETED,
//    still past its deadline) in DataDeletionService.purgeExpired. Whoever holds the lock
//    wins; a record restored first is never purged; a record somebody else holds is left
//    for the next run. Running it twice is harmless: the second finds nothing to do.
//  * It cannot bypass the database: the update goes through the same lifecycle trigger as
//    every other transition, and a CHECK refuses an automatic purge at or before the
//    deadline.
//  * A failure rolls back that record's transaction, leaves it DELETED and is logged; the
//    next run tries again. After MAX_CONSECUTIVE_FAILURES in a row the run stops (the
//    database is probably away) instead of logging one failure per record.
//  * Logs are one JSON line each and carry ids, counts and timestamps only: never a label,
//    a reason, a snapshot or any personal data, and never an error message (which may quote
//    data): just the error's class and code.
//
// Settings (environment):
//   DATA_DELETION_AUTOPURGE                     "off" / "false" / "0" turns the worker off
//   DATA_DELETION_AUTOPURGE_INTERVAL_MINUTES    minutes between runs (default 60, 1 to 1440)
//   DATA_DELETION_AUTOPURGE_FIRST_RUN_SECONDS   delay before the first run (default 90)

export const PURGE_WORKER_OPTIONS = 'DATA_DELETION_PURGE_WORKER_OPTIONS';

export const AUTO_PURGE_DEFAULTS = {
  intervalMinutes: 60,
  firstRunDelaySeconds: 90,
  batchSize: 50,
  maxBatchesPerRun: 20,
  maxConsecutiveFailures: 5,
} as const;

export interface PurgeWorkerOptions {
  enabled: boolean;
  intervalMs: number;
  firstRunDelayMs: number;
  batchSize: number;
  maxBatchesPerRun: number;
  maxConsecutiveFailures: number;
  // For tests: the clock used for log timestamps, and the jitter source.
  now: () => Date;
  random: () => number;
}

export function readPurgeWorkerOptions(
  env: Record<string, string | undefined> = process.env,
): PurgeWorkerOptions {
  const flag = (env.DATA_DELETION_AUTOPURGE ?? '').trim().toLowerCase();
  const number = (
    raw: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const n = Number(raw);

    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };

  return {
    enabled: !['off', 'false', '0', 'no'].includes(flag),
    intervalMs:
      number(
        env.DATA_DELETION_AUTOPURGE_INTERVAL_MINUTES,
        AUTO_PURGE_DEFAULTS.intervalMinutes,
        1,
        1440,
      ) * 60000,
    firstRunDelayMs:
      number(
        env.DATA_DELETION_AUTOPURGE_FIRST_RUN_SECONDS,
        AUTO_PURGE_DEFAULTS.firstRunDelaySeconds,
        0,
        3600,
      ) * 1000,
    batchSize: AUTO_PURGE_DEFAULTS.batchSize,
    maxBatchesPerRun: AUTO_PURGE_DEFAULTS.maxBatchesPerRun,
    maxConsecutiveFailures: AUTO_PURGE_DEFAULTS.maxConsecutiveFailures,
    now: () => new Date(),
    random: Math.random,
  };
}

export interface PurgeRunSummary {
  // false when the run did not start because another was still running
  started: boolean;
  batches: number;
  purged: number;
  // held by a restore, a manual purge or another worker: left for the next run
  locked: number;
  // restored or purged by someone else between the page and the lock
  notDeleted: number;
  notDue: number;
  failed: number;
  // stopped early: the cap on batches, repeated failures, or shutdown
  stoppedBy: 'DONE' | 'BATCH_LIMIT' | 'FAILURES' | 'SHUTDOWN' | 'UNAVAILABLE';
  durationMs: number;
}

const EMPTY: Omit<PurgeRunSummary, 'started' | 'durationMs'> = {
  batches: 0,
  purged: 0,
  locked: 0,
  notDeleted: 0,
  notDue: 0,
  failed: 0,
  stoppedBy: 'DONE',
};

@Injectable()
export class DataDeletionPurgeWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DataDeletionPurgeWorker.name);
  private readonly options: PurgeWorkerOptions;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<PurgeRunSummary>;
  private stopping = false;

  constructor(
    private readonly deletions: DataDeletionService,
    @Optional()
    @Inject(PURGE_WORKER_OPTIONS)
    options?: Partial<PurgeWorkerOptions>,
  ) {
    this.options = { ...readPurgeWorkerOptions(), ...(options ?? {}) };
  }

  onApplicationBootstrap(): void {
    if (!this.options.enabled) {
      this.log('log', 'data_deletion.auto_purge.disabled', {});

      return;
    }

    this.log('log', 'data_deletion.auto_purge.started', {
      intervalMinutes: Math.round(this.options.intervalMs / 60000),
      firstRunInSeconds: Math.round(this.options.firstRunDelayMs / 1000),
      batchSize: this.options.batchSize,
      maxBatchesPerRun: this.options.maxBatchesPerRun,
    });
    this.schedule(this.options.firstRunDelayMs);
  }

  // Stops the timer and lets a run that is in flight finish its current record: nothing
  // is abandoned half way (a hard kill would only roll the open transaction back).
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.inFlight) {
      await this.inFlight;
    }

    this.log('log', 'data_deletion.auto_purge.stopped', {});
  }

  // One run. Returns what it did. Never throws: a failure is counted and logged.
  async runOnce(): Promise<PurgeRunSummary> {
    if (this.inFlight) {
      this.log('warn', 'data_deletion.auto_purge.run_skipped', {
        reason: 'previous run still in progress',
      });

      return { ...EMPTY, started: false, durationMs: 0 };
    }

    this.inFlight = this.execute().finally(() => {
      this.inFlight = undefined;
    });

    return this.inFlight;
  }

  private schedule(delayMs: number): void {
    if (this.stopping) {
      return;
    }

    // +-10% jitter so instances started together do not wake together.
    const jitter = 1 + (this.options.random() - 0.5) * 0.2;

    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.runOnce().finally(() =>
          this.schedule(this.options.intervalMs),
        );
      },
      Math.max(0, Math.round(delayMs * jitter)),
    );
    this.timer.unref?.();
  }

  private async execute(): Promise<PurgeRunSummary> {
    const startedAt = Date.now();
    const summary = { ...EMPTY, started: true, durationMs: 0 };
    let cursor: { purgeAfter: Date; id: string } | undefined;
    let consecutiveFailures = 0;

    this.log('log', 'data_deletion.auto_purge.run_started', {});

    for (;;) {
      if (this.stopping) {
        summary.stoppedBy = 'SHUTDOWN';
        break;
      }

      if (summary.batches >= this.options.maxBatchesPerRun) {
        summary.stoppedBy = 'BATCH_LIMIT';
        break;
      }

      let page: Array<{
        id: string;
        entityType: string;
        purgeAfter: Date;
      }>;

      try {
        page = await this.deletions.findExpiredTombstones(
          this.options.batchSize,
          cursor,
        );
      } catch (error) {
        summary.failed += 1;
        summary.stoppedBy = this.isMissingTable(error)
          ? 'UNAVAILABLE'
          : 'FAILURES';
        this.logFailure(error, undefined, summary.stoppedBy);
        break;
      }

      if (page.length === 0) {
        break;
      }

      summary.batches += 1;

      for (const row of page) {
        if (this.stopping) {
          summary.stoppedBy = 'SHUTDOWN';
          break;
        }

        try {
          const outcome = await this.deletions.purgeExpired(row.id);
          consecutiveFailures = 0;

          if (outcome === 'PURGED') {
            summary.purged += 1;
            this.log('log', 'data_deletion.auto_purge.record_purged', {
              tombstoneId: row.id,
              entityType: row.entityType,
              purgeAfter: row.purgeAfter.toISOString(),
              purgedAt: this.options.now().toISOString(),
              actor: 'system',
            });
          } else if (outcome === 'LOCKED') {
            summary.locked += 1;
          } else if (outcome === 'NOT_DUE') {
            summary.notDue += 1;
          } else {
            summary.notDeleted += 1;
          }
        } catch (error) {
          summary.failed += 1;
          consecutiveFailures += 1;
          this.logFailure(error, row.id, 'RECORD_FAILED');

          if (consecutiveFailures >= this.options.maxConsecutiveFailures) {
            summary.stoppedBy = 'FAILURES';
            break;
          }
        }
      }

      if (summary.stoppedBy !== 'DONE') {
        break;
      }

      const last = page[page.length - 1];
      cursor = { purgeAfter: last.purgeAfter, id: last.id };

      if (page.length < this.options.batchSize) {
        break;
      }
    }

    summary.durationMs = Date.now() - startedAt;
    this.log(
      summary.failed > 0 ? 'warn' : 'log',
      'data_deletion.auto_purge.run_finished',
      {
        batches: summary.batches,
        purged: summary.purged,
        locked: summary.locked,
        notDeleted: summary.notDeleted,
        notDue: summary.notDue,
        failed: summary.failed,
        stoppedBy: summary.stoppedBy,
        durationMs: summary.durationMs,
      },
    );

    return summary;
  }

  private isMissingTable(error: unknown): boolean {
    return (error as { code?: string } | null)?.code === 'P2021';
  }

  // The class and the code of an error, never its message.
  private logFailure(
    error: unknown,
    tombstoneId: string | undefined,
    kind: string,
  ): void {
    const e = error as { code?: unknown; constructor?: { name?: string } };

    this.log(
      kind === 'UNAVAILABLE' ? 'warn' : 'error',
      'data_deletion.auto_purge.failed',
      {
        kind,
        ...(tombstoneId ? { tombstoneId } : {}),
        errorClass: e?.constructor?.name ?? 'Error',
        ...(typeof e?.code === 'string' ? { errorCode: e.code } : {}),
      },
    );
  }

  // One JSON line: { event, at, ...fields }.
  private log(
    level: 'log' | 'warn' | 'error',
    event: string,
    fields: Record<string, unknown>,
  ): void {
    this.logger[level](
      JSON.stringify({
        event,
        at: this.options.now().toISOString(),
        ...fields,
      }),
    );
  }
}

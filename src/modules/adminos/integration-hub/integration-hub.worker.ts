import { Worker } from 'bullmq';

const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
};

export const INTEGRATION_SYNC_WORKER = 'integration-sync-worker';

export const integrationSyncWorker = new Worker(
  'integration-sync',
  async (job) => {
    console.log(
      `[IntegrationSyncWorker] Processing job ${job.id}`,
      job.data,
    );

    return {
      processed: true,
      jobId: job.id,
    };
  },
  {
    connection: redisConnection,
  },
);

integrationSyncWorker.on('completed', (job) => {
  console.log(
    `[IntegrationSyncWorker] Job completed: ${job.id}`,
  );
});

integrationSyncWorker.on('failed', (job, error) => {
  console.error(
    `[IntegrationSyncWorker] Job failed: ${job?.id}`,
    error,
  );
});

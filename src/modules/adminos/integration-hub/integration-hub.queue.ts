import { Queue } from 'bullmq';

const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
};

export const INTEGRATION_SYNC_QUEUE = 'integration-sync';

export const integrationSyncQueue = new Queue(
  INTEGRATION_SYNC_QUEUE,
  {
    connection: redisConnection,
  },
);

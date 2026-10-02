import { createServer } from 'node:http';
import { buildContainer } from './bootstrap.js';
import { ConfigError, loadConfig, type AppConfig } from './shared/infrastructure/config/env.js';
import { JobRunner } from './shared/infrastructure/jobs/job-runner.js';

let config: AppConfig;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

const container = await buildContainer(config);
const { logger } = container;

const server = createServer(container.app);
// Slow-loris / oversized-request protection at the socket level (spec §9.1 step 0).
server.headersTimeout = 15_000;
server.requestTimeout = 20_000;
server.keepAliveTimeout = 5_000;

const jobs = new JobRunner(container.jobs, config.jobs.intervalMs, logger);

server.listen(config.port, () => {
  logger.info({ port: config.port, jobs: config.jobs.enabled }, 'API listening');
  if (config.jobs.enabled) jobs.start();
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => {
    logger.error({ signal }, 'forced shutdown after 15 s');
    process.exit(1);
  }, 15_000);
  force.unref();
  server.close();
  server.closeIdleConnections();
  await jobs.stop();
  await container.close();
  clearTimeout(force);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});

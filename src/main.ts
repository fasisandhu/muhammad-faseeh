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
    server.closeAllConnections();
    process.exit(1);
  }, 15_000);
  force.unref();
  try {
    // Stop accepting connections and let in-flight requests finish before closing Redis and the pool.
    const closed = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    server.closeIdleConnections();
    await closed;
    await jobs.stop();
    await container.close();
    clearTimeout(force);
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'shutdown failed');
    process.exitCode = 1;
    clearTimeout(force);
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});

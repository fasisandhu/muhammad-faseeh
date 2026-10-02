import type { Job } from '../../application/jobs.js';
import type { Logger } from '../../application/logger.js';
import { sleep } from '../system/sleep.js';

/** In-process scheduler: fixed interval, no overlapping runs per job, graceful stop. */
export class JobRunner {
  private timer: NodeJS.Timeout | null = null;
  private readonly running = new Set<string>();

  constructor(
    private readonly jobs: readonly Job[],
    private readonly intervalMs: number,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  async tick(): Promise<void> {
    await Promise.all(
      this.jobs.map(async (job) => {
        if (this.running.has(job.name)) return;
        this.running.add(job.name);
        const startedAt = Date.now();
        try {
          const result = await job.run();
          this.logger.debug({ job: job.name, durationMs: Date.now() - startedAt, result }, 'job finished');
        } catch (error) {
          this.logger.error({ job: job.name, err: error }, 'job failed');
        } finally {
          this.running.delete(job.name);
        }
      }),
    );
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running.size > 0) await sleep(20);
  }
}

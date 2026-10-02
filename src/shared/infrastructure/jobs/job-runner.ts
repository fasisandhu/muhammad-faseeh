import type { Job } from '../../application/jobs.js';
import type { Logger } from '../../application/logger.js';
import { sleep } from '../system/sleep.js';

/**
 * In-process scheduler: a first tick shortly after start (so renewals due while the API was down are processed
 * at once, not one interval later), then a fixed interval; no overlapping runs per job; graceful stop.
 */
export class JobRunner {
  private timer: NodeJS.Timeout | null = null;
  private firstTick: NodeJS.Timeout | null = null;
  private readonly running = new Set<string>();
  private readonly initialDelayMs: number;

  constructor(
    private readonly jobs: readonly Job[],
    private readonly intervalMs: number,
    private readonly logger: Logger,
    options: { initialDelayMs?: number } = {},
  ) {
    this.initialDelayMs = options.initialDelayMs ?? 1_000;
  }

  start(): void {
    if (this.timer) return;
    this.firstTick = setTimeout(() => {
      this.firstTick = null;
      void this.tick();
    }, this.initialDelayMs);
    this.firstTick.unref();
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
    if (this.firstTick) clearTimeout(this.firstTick);
    this.firstTick = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running.size > 0) await sleep(20);
  }
}

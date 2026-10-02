import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobRunner } from '../../../../src/shared/infrastructure/jobs/job-runner.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('JobRunner', () => {
  it('runs every job on each tick and logs failures without throwing', async () => {
    const ok = { name: 'ok', run: vi.fn().mockResolvedValue({ processed: 1 }) };
    const broken = { name: 'broken', run: vi.fn().mockRejectedValue(new Error('boom')) };
    const runner = new JobRunner([ok, broken], 60_000, logger);
    await runner.tick();
    expect(ok.run).toHaveBeenCalledOnce();
    expect(broken.run).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ job: 'broken' }), 'job failed');
  });

  it('never overlaps runs of the same job', async () => {
    let release!: () => void;
    const slow = {
      name: 'slow',
      run: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    };
    const runner = new JobRunner([slow], 60_000, logger);
    const first = runner.tick();
    await runner.tick();
    expect(slow.run).toHaveBeenCalledOnce();
    release();
    await first;
  });

  it('waits for running jobs on stop', async () => {
    let finished = false;
    const job = {
      name: 'job',
      run: () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            finished = true;
            resolve();
          }, 50),
        ),
    };
    const runner = new JobRunner([job], 60_000, logger);
    void runner.tick();
    await runner.stop();
    expect(finished).toBe(true);
  });

  describe('scheduling', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('runs a first tick shortly after start, then on every interval', async () => {
      vi.useFakeTimers();
      const job = { name: 'billing', run: vi.fn().mockResolvedValue(undefined) };
      const runner = new JobRunner([job], 60_000, logger, { initialDelayMs: 1_000 });
      runner.start();
      await vi.advanceTimersByTimeAsync(999);
      expect(job.run).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(job.run).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(job.run).toHaveBeenCalledTimes(2);
      await runner.stop();
    });

    it('never starts the first tick after stop', async () => {
      vi.useFakeTimers();
      const job = { name: 'billing', run: vi.fn().mockResolvedValue(undefined) };
      const runner = new JobRunner([job], 60_000, logger, { initialDelayMs: 1_000 });
      runner.start();
      await runner.stop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(job.run).not.toHaveBeenCalled();
    });

    it('waits for an in-flight first tick on stop', async () => {
      vi.useFakeTimers();
      let finished = false;
      const job = {
        name: 'billing',
        run: () =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              finished = true;
              resolve();
            }, 500),
          ),
      };
      const runner = new JobRunner([job], 60_000, logger, { initialDelayMs: 1_000 });
      runner.start();
      await vi.advanceTimersByTimeAsync(1_000);
      const stopped = runner.stop();
      await vi.advanceTimersByTimeAsync(600);
      await stopped;
      expect(finished).toBe(true);
    });
  });
});

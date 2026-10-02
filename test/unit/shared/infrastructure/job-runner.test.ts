import { describe, expect, it, vi } from 'vitest';
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
});

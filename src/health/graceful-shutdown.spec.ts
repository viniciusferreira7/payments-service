import { createShutdownHandler } from './graceful-shutdown';
import { ShutdownService } from './shutdown.service';

describe('createShutdownHandler', () => {
  it('fails the readiness probe before draining connections', async () => {
    const shutdownService = new ShutdownService();
    const events: string[] = [];

    const handler = createShutdownHandler({
      shutdownService,
      drainDelayMs: 10_000,
      close: async () => {
        events.push('close');
      },
      wait: async () => {
        events.push(`wait:${shutdownService.isShuttingDown}`);
      },
    });

    await handler('SIGTERM');

    expect(events).toEqual(['wait:true', 'close']);
  });

  it('waits for the configured drain delay before closing the server', async () => {
    const shutdownService = new ShutdownService();
    const waitedFor: number[] = [];

    const handler = createShutdownHandler({
      shutdownService,
      drainDelayMs: 7_500,
      close: async () => {
        // the drain delay is what this test asserts on
      },
      wait: async (ms) => {
        waitedFor.push(ms);
      },
    });

    await handler('SIGTERM');

    expect(waitedFor).toEqual([7_500]);
  });

  it('closes the server only once when a second signal arrives', async () => {
    const shutdownService = new ShutdownService();
    let closeCalls = 0;

    const handler = createShutdownHandler({
      shutdownService,
      drainDelayMs: 0,
      close: async () => {
        closeCalls++;
      },
      wait: async () => {
        // no drain delay: this test only counts close calls
      },
    });

    await Promise.all([handler('SIGTERM'), handler('SIGINT')]);
    await handler('SIGTERM');

    expect(closeCalls).toBe(1);
  });
});

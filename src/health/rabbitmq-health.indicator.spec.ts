import type { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';
import {
  RABBITMQ_CHECK_TIMEOUT_MS,
  RabbitmqHealthIndicator,
} from './rabbitmq-health.indicator';

function indicatorFor(channel: unknown) {
  return new RabbitmqHealthIndicator({
    getChannel: () => channel,
  } as unknown as RabbitmqService);
}

describe('RabbitmqHealthIndicator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports up when the broker confirms amq.direct', async () => {
    const checkExchange = vi.fn(async () => ({}));

    await expect(
      indicatorFor({ checkExchange }).check()
    ).resolves.toMatchObject({ status: 'up' });
    expect(checkExchange).toHaveBeenCalledWith('amq.direct');
  });

  it('reports down when there is no channel yet', async () => {
    await expect(indicatorFor(undefined).check()).resolves.toMatchObject({
      status: 'down',
    });
  });

  it('reports down when the broker check fails', async () => {
    await expect(
      indicatorFor({
        checkExchange: () => Promise.reject(new Error('Channel closed')),
      }).check()
    ).resolves.toMatchObject({ status: 'down' });
  });

  it('reports down when the closed channel throws instead of rejecting', async () => {
    await expect(
      indicatorFor({
        checkExchange: () => {
          throw new Error('Channel closed');
        },
      }).check()
    ).resolves.toMatchObject({ status: 'down' });
  });

  it('reports down instead of hanging when the broker never answers', async () => {
    vi.useFakeTimers();

    const pending = indicatorFor({
      checkExchange: () =>
        new Promise(() => {
          // never settles: a broker that accepted the connection and hung
        }),
    }).check();

    await vi.advanceTimersByTimeAsync(RABBITMQ_CHECK_TIMEOUT_MS);

    await expect(pending).resolves.toMatchObject({ status: 'down' });
  });
});

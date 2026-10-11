import { Injectable, Logger } from '@nestjs/common';
import { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';

export const RABBITMQ_CHECK_TIMEOUT_MS = 2000;

/** Pre-declared in every vhost, so checking it never closes the channel. */
const PROBE_EXCHANGE = 'amq.direct';

export type RabbitmqHealth = {
  status: 'up' | 'down';
  responseTime: number;
};

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`RabbitMQ check timed out after ${ms}ms`)),
        ms
      );
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

@Injectable()
export class RabbitmqHealthIndicator {
  private readonly logger = new Logger(RabbitmqHealthIndicator.name);

  constructor(private readonly rabbitmqService: RabbitmqService) {}

  async check(): Promise<RabbitmqHealth> {
    const startedAt = Date.now();

    try {
      const channel = this.rabbitmqService.getChannel();

      if (!channel) {
        throw new Error('No RabbitMQ channel');
      }

      // A closed channel throws synchronously; the async wrapper turns that
      // into a rejection the timeout race can handle.
      await withTimeout(
        (async () => channel.checkExchange(PROBE_EXCHANGE))(),
        RABBITMQ_CHECK_TIMEOUT_MS
      );

      return {
        status: 'up',
        responseTime: Date.now() - startedAt,
      };
    } catch (err) {
      this.logger.error({ err }, '[Health] RabbitMQ check failed');

      return {
        status: 'down',
        responseTime: Date.now() - startedAt,
      };
    }
  }
}

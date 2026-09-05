import type { INestApplication } from '@nestjs/common';
import type { PaymentOrderMessage } from '@/events/interfaces/payments-queue.interface';
import { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';
import { waitUntil } from '../utils/wait-until';
import type { BrokerTopology } from './broker-topology';

export class BrokerHarness {
  constructor(
    private readonly rabbitmq: RabbitmqService,
    readonly topology: BrokerTopology
  ) {}

  async messageCount(queue: string = this.topology.dlq): Promise<number> {
    const { messageCount } = await this.rabbitmq.getChannel().checkQueue(queue);

    return messageCount;
  }

  async waitForTopology(): Promise<void> {
    await waitUntil('the payments queue is declared', async () => {
      try {
        await this.messageCount();
        return true;
      } catch {
        return false;
      }
    });
  }

  async purge(): Promise<void> {
    await this.rabbitmq.getChannel().purgeQueue(this.topology.queue);
    await this.rabbitmq.getChannel().purgeQueue(this.topology.dlq);
    // A message still waiting out its TTL would come back on the main queue
    // mid-spec, so the retry queue has to be emptied along with the others.
    await this.rabbitmq.getChannel().purgeQueue(this.topology.retryQueue);
  }

  async publishOrder(order: PaymentOrderMessage): Promise<void> {
    await this.rabbitmq.publicMessage({
      exchange: this.topology.exchange,
      routingKey: this.topology.routingKey,
      message: order,
    });
  }

  async deadLetter(...orders: PaymentOrderMessage[]): Promise<void> {
    for (const order of orders) {
      this.rabbitmq
        .getChannel()
        .publish(
          this.topology.dlxExchange,
          this.topology.dlqRoutingKey,
          Buffer.from(JSON.stringify(order)),
          { persistent: true, contentType: 'application/json' }
        );
    }

    await waitUntil(
      `${orders.length} message(s) reach the dead letter queue`,
      async () => (await this.messageCount()) === orders.length
    );
  }

  async waitForDeadLetterCount(count: number): Promise<void> {
    await waitUntil(
      `the dead letter queue holds ${count} message(s)`,
      async () => (await this.messageCount()) === count
    );
  }

  async waitForDrainedQueues(): Promise<void> {
    await waitUntil(
      'both queues are drained',
      async () =>
        (await this.messageCount()) === 0 &&
        (await this.messageCount(this.topology.queue)) === 0
    );
  }

  /**
   * The `x-death` history the broker stamped on the message the DLQ holds.
   * A message only reaches the DLQ after the retry loop, so the entry that
   * matters is rarely the first one.
   */
  deathsOf(message: {
    properties: { headers?: Record<string, unknown> };
  }): Array<Record<string, unknown>> {
    const deaths = message.properties.headers?.['x-death'];

    return Array.isArray(deaths) ? deaths : [];
  }
}

export function makeBrokerHarness(
  app: INestApplication,
  topology: BrokerTopology
): BrokerHarness {
  return new BrokerHarness(app.get(RabbitmqService), topology);
}

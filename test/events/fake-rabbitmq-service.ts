import { Logger } from '@nestjs/common';
import type { PublicMessageParams } from '@/events/interfaces/public-message.interface';
import type { SubscribeToQueue } from '@/events/interfaces/subscribe-to-queue.interface';
import type { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';

/**
 * Stand-in for `RabbitmqService` in tests.
 *
 * The real service opens an AMQP connection in `onModuleInit`, so booting the
 * application without a broker would either hang or log a connection error on
 * every spec. This keeps the lifecycle hooks as no-ops and records what the
 * suite asked it to do, so assertions can be made without external infra.
 *
 * `getChannel` returns a truthy stub so consumers that guard on a live channel
 * behave as they would against a connected broker. `subscribeToQueue` records
 * the subscription and `deliver` drives a message through its callback:
 *
 * ```ts
 * await fake.deliver('payment_queue', makeOrder());
 * ```
 */
export class FakeRabbitmqService implements Partial<RabbitmqService> {
  private readonly logger = new Logger(FakeRabbitmqService.name);

  connected = false;

  readonly published: PublicMessageParams[] = [];
  readonly subscriptions = new Map<string, SubscribeToQueue>();

  async onModuleInit() {
    this.connected = true;
    this.logger.debug('Fake RabbitMQ connected');
  }

  async onModuleDestroy() {
    this.connected = false;
    this.logger.debug('Fake RabbitMQ disconnected');
  }

  getChannel() {
    return {} as ReturnType<RabbitmqService['getChannel']>;
  }

  async publicMessage(params: PublicMessageParams) {
    this.published.push(params);
  }

  async subscribeToQueue(params: SubscribeToQueue) {
    this.subscriptions.set(params.queueName, params);
  }

  /** Drives a message through the callback registered for `queueName`. */
  async deliver(queueName: string, message: unknown) {
    const subscription = this.subscriptions.get(queueName);

    if (!subscription) {
      throw new Error(`No subscription registered for queue: ${queueName}`);
    }

    await subscription.callback(message);
  }
}

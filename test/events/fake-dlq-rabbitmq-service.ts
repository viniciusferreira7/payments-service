import type { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';
import {
  type DlqDelivery,
  makeDlqChannel,
  makeDlqDelivery,
  orderIdsIn,
} from './fake-dlq-channel';
import { FakeRabbitmqService } from './fake-rabbitmq-service';

/** Whether a value is already a delivery rather than a payload to wrap. */
function isDelivery(message: unknown): message is DlqDelivery {
  return (
    typeof message === 'object' &&
    message !== null &&
    Buffer.isBuffer((message as DlqDelivery).content)
  );
}

/**
 * A {@link FakeRabbitmqService} whose channel is the dead letter double from
 * `fake-dlq-channel`, so anything reading the queue — `DlqService`, the HTTP
 * endpoints above it — acts on a queue that behaves like the real one: `get`
 * hands out the head, `ack` drops it and a requeueing `nack` puts it back at
 * the head.
 *
 * ```ts
 * const rabbitmq = new FakeDlqRabbitmqService();
 *
 * rabbitmq.seed(makePaymentOrder({ orderId: 'order-1' }));
 *
 * const moduleRef = await makeModuleRef((builder) =>
 *   builder.overrideProvider(RabbitmqService).useValue(rabbitmq)
 * );
 * ```
 */
export class FakeDlqRabbitmqService extends FakeRabbitmqService {
  readonly dlq = makeDlqChannel();

  getChannel() {
    return this.dlq as unknown as ReturnType<RabbitmqService['getChannel']>;
  }

  /**
   * Appends messages to the dead letter queue. Each entry is either a
   * ready-made delivery — for cases that need headers, such as `x-death` — or a
   * payload to wrap in one, including a string that `JSON.parse` will reject:
   *
   * ```ts
   * rabbitmq.seed(makePaymentOrder({ orderId: 'order-1' }), 'not json');
   * rabbitmq.seed(makeDlqDelivery(order, { messageId: 'message-1' }));
   * ```
   *
   * Returns the service so a spec can seed as it builds it.
   */
  seed(...messages: unknown[]): this {
    for (const message of messages) {
      this.dlq.queue.push(
        isDelivery(message) ? message : makeDlqDelivery(message)
      );
    }

    return this;
  }

  /** The order ids left in the dead letter queue, head first. */
  get orderIds(): string[] {
    return orderIdsIn(this.dlq.queue);
  }
}

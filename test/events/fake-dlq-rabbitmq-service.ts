import type { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';
import {
  type DlqDelivery,
  makeDlqChannel,
  makeDlqDelivery,
  orderIdsIn,
} from './fake-dlq-channel';
import { FakeRabbitmqService } from './fake-rabbitmq-service';

function isDelivery(message: unknown): message is DlqDelivery {
  return (
    typeof message === 'object' &&
    message !== null &&
    Buffer.isBuffer((message as DlqDelivery).content)
  );
}

export class FakeDlqRabbitmqService extends FakeRabbitmqService {
  readonly dlq = makeDlqChannel();

  getChannel() {
    return this.dlq as unknown as ReturnType<RabbitmqService['getChannel']>;
  }

  seed(...messages: unknown[]): this {
    for (const message of messages) {
      this.dlq.queue.push(
        isDelivery(message) ? message : makeDlqDelivery(message)
      );
    }

    return this;
  }

  get orderIds(): string[] {
    return orderIdsIn(this.dlq.queue);
  }
}

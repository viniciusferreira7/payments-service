import { Test, type TestingModule } from '@nestjs/testing';
import {
  makeDlqChannel,
  makeDlqDelivery,
  orderIdsIn,
} from 'test/events/fake-dlq-channel';
import { EnvService } from '@/env/env.service';
import type { PaymentOrderMessage } from '../interfaces/payments-queue.interface';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { DlqService } from './dlq.service';

const env: Record<string, string> = {
  RABBITMQ_QUEUE_PAYMENTS: 'payment_queue',
  RABBITMQ_EXCHANGE: 'payments',
  RABBITMQ_ROUTING_KEY_PAYMENT_ORDER: 'payment.order',
};

const DLQ_NAME = 'payment_queue.dlq';

function makeOrder(
  overrides: Partial<PaymentOrderMessage> = {}
): PaymentOrderMessage {
  return {
    orderId: 'order-1',
    userId: 'user-1',
    amount: 100,
    discount: 0,
    items: [{ productId: 'product-1', quantity: 1, price: 100 }],
    paymentMethod: 'credit_card',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('DlqService', () => {
  let service: DlqService;
  let rabbitMqService: {
    getChannel: ReturnType<typeof vi.fn>;
    publicMessage: ReturnType<typeof vi.fn>;
  };

  async function setup(channel: unknown) {
    rabbitMqService = {
      getChannel: vi.fn(() => channel),
      publicMessage: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DlqService,
        { provide: RabbitmqService, useValue: rabbitMqService },
        { provide: EnvService, useValue: { get: vi.fn((k) => env[k]) } },
      ],
    }).compile();

    service = module.get<DlqService>(DlqService);
  }

  describe('getStats', () => {
    it('reports the queue depth from the broker', async () => {
      await setup(makeDlqChannel([makeDlqDelivery(makeOrder())]));

      await expect(service.getStats()).resolves.toEqual({
        queueName: DLQ_NAME,
        messageCount: 1,
        consumerCount: 0,
      });
    });

    it('fails when the channel is not available', async () => {
      await setup(undefined);

      await expect(service.getStats()).rejects.toThrow(
        'RabbitMQ channel not available'
      );
    });
  });

  describe('peekMessages', () => {
    it('returns each message once instead of re-reading the head', async () => {
      const channel = makeDlqChannel([
        makeDlqDelivery(makeOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makeOrder({ orderId: 'order-2' })),
        makeDlqDelivery(makeOrder({ orderId: 'order-3' })),
      ]);
      await setup(channel);

      const messages = await service.peekMessages(10);

      expect(messages.map((message) => message.content.orderId)).toEqual([
        'order-1',
        'order-2',
        'order-3',
      ]);
    });

    it('leaves the queue untouched and in order', async () => {
      const channel = makeDlqChannel([
        makeDlqDelivery(makeOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makeOrder({ orderId: 'order-2' })),
        makeDlqDelivery(makeOrder({ orderId: 'order-3' })),
      ]);
      await setup(channel);

      await service.peekMessages(10);

      expect(orderIdsIn(channel.queue)).toEqual([
        'order-1',
        'order-2',
        'order-3',
      ]);
      expect(channel.ack).not.toHaveBeenCalled();
    });

    it('stops at the limit', async () => {
      const channel = makeDlqChannel([
        makeDlqDelivery(makeOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makeOrder({ orderId: 'order-2' })),
        makeDlqDelivery(makeOrder({ orderId: 'order-3' })),
      ]);
      await setup(channel);

      const messages = await service.peekMessages(2);

      expect(messages).toHaveLength(2);
      expect(channel.queue).toHaveLength(3);
    });

    it('returns nothing when the queue is empty', async () => {
      await setup(makeDlqChannel());

      await expect(service.peekMessages()).resolves.toEqual([]);
    });

    it('maps the death info recorded by the broker', async () => {
      const channel = makeDlqChannel([
        makeDlqDelivery(makeOrder(), {
          messageId: 'message-1',
          timestamp: 1_700_000_000,
          headers: {
            'x-death': [
              {
                reason: 'rejected',
                queue: 'payment_queue',
                time: new Date('2026-02-03T04:05:06.000Z'),
                count: 2,
                exchange: 'payments',
                'routing-keys': ['payment.order'],
              },
            ],
          },
        }),
      ]);
      await setup(channel);

      const [message] = await service.peekMessages();

      expect(message.properties.messageId).toBe('message-1');
      expect(message.properties.timestamp).toBe(1_700_000_000);
      expect(message.deathInfo).toEqual({
        reason: 'rejected',
        queue: 'payment_queue',
        time: new Date('2026-02-03T04:05:06.000Z'),
        count: 2,
        exchange: 'payments',
        routingKeys: ['payment.order'],
      });
    });

    it('skips a malformed payload but still puts it back', async () => {
      const channel = makeDlqChannel([
        makeDlqDelivery('not json'),
        makeDlqDelivery(makeOrder({ orderId: 'order-2' })),
      ]);
      await setup(channel);

      const messages = await service.peekMessages();

      expect(messages.map((message) => message.content.orderId)).toEqual([
        'order-2',
      ]);
      expect(channel.queue).toHaveLength(2);
    });
  });

  describe('reprocessMessage', () => {
    it('republishes the matching message and acks it', async () => {
      const channel = makeDlqChannel([
        makeDlqDelivery(makeOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makeOrder({ orderId: 'order-2' })),
      ]);
      await setup(channel);

      await expect(service.reprocessMessage('order-2')).resolves.toBe(true);

      expect(rabbitMqService.publicMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          exchange: 'payments',
          routingKey: 'payment.order',
          message: expect.objectContaining({ orderId: 'order-2' }),
        })
      );
      expect(channel.ack).toHaveBeenCalledTimes(1);
    });

    it('puts the messages it scanned past back on the queue', async () => {
      const channel = makeDlqChannel([
        makeDlqDelivery(makeOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makeOrder({ orderId: 'order-2' })),
        makeDlqDelivery(makeOrder({ orderId: 'order-3' })),
      ]);
      await setup(channel);

      await service.reprocessMessage('order-3');

      expect(orderIdsIn(channel.queue)).toEqual(['order-1', 'order-2']);
    });

    it('stops scanning once it finds the order', async () => {
      const channel = makeDlqChannel([
        makeDlqDelivery(makeOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makeOrder({ orderId: 'order-2' })),
        makeDlqDelivery(makeOrder({ orderId: 'order-3' })),
      ]);
      await setup(channel);

      await service.reprocessMessage('order-1');

      expect(channel.get).toHaveBeenCalledTimes(1);
    });

    it('reports no match and leaves the queue whole', async () => {
      const channel = makeDlqChannel([
        makeDlqDelivery(makeOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makeOrder({ orderId: 'order-2' })),
      ]);
      await setup(channel);

      await expect(service.reprocessMessage('order-9')).resolves.toBe(false);

      expect(rabbitMqService.publicMessage).not.toHaveBeenCalled();
      expect(orderIdsIn(channel.queue)).toEqual(['order-1', 'order-2']);
    });

    it('keeps a malformed message on the queue while it searches', async () => {
      const channel = makeDlqChannel([
        makeDlqDelivery('not json'),
        makeDlqDelivery(makeOrder({ orderId: 'order-2' })),
      ]);
      await setup(channel);

      await expect(service.reprocessMessage('order-2')).resolves.toBe(true);

      expect(channel.queue).toHaveLength(1);
    });
  });

  describe('reprocessAll', () => {
    it('republishes every message and drains the queue', async () => {
      const channel = makeDlqChannel([
        makeDlqDelivery(makeOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makeOrder({ orderId: 'order-2' })),
      ]);
      await setup(channel);

      await expect(service.reprocessAll()).resolves.toEqual({
        processed: 2,
        failed: 0,
      });

      expect(rabbitMqService.publicMessage).toHaveBeenCalledTimes(2);
      expect(channel.queue).toHaveLength(0);
    });

    it('counts a malformed message once and leaves it behind', async () => {
      const channel = makeDlqChannel([
        makeDlqDelivery('not json'),
        makeDlqDelivery(makeOrder({ orderId: 'order-2' })),
      ]);
      await setup(channel);

      await expect(service.reprocessAll()).resolves.toEqual({
        processed: 1,
        failed: 1,
      });

      expect(channel.queue).toHaveLength(1);
      expect(channel.queue[0].content.toString()).toBe('not json');
    });

    it('does nothing on an empty queue', async () => {
      const channel = makeDlqChannel();
      await setup(channel);

      await expect(service.reprocessAll()).resolves.toEqual({
        processed: 0,
        failed: 0,
      });

      expect(rabbitMqService.publicMessage).not.toHaveBeenCalled();
    });
  });
});

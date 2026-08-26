import { Test, type TestingModule } from '@nestjs/testing';
import { EnvService } from '@/env/env.service';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import type { IncomingPaymentOrderMessage } from './payment-queue.service';
import { PaymentQueueService } from './payment-queue.service';

const env: Record<string, string> = {
  RABBITMQ_QUEUE_PAYMENTS: 'payment_queue',
  RABBITMQ_EXCHANGE: 'payments',
  RABBITMQ_ROUTING_KEY_PAYMENT_ORDER: 'payment.order',
};

function makeOrder(
  overrides: Partial<IncomingPaymentOrderMessage> = {}
): IncomingPaymentOrderMessage {
  return {
    orderId: 'order-1',
    userId: 'user-1',
    amount: 100,
    discount: 0,
    items: [{ productId: 'product-1', quantity: 1, price: 100 }],
    paymentMethod: 'credit_card',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PaymentQueueService', () => {
  let service: PaymentQueueService;
  let rabbitMqService: {
    subscribeToQueue: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    rabbitMqService = {
      subscribeToQueue: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentQueueService,
        { provide: RabbitmqService, useValue: rabbitMqService },
        { provide: EnvService, useValue: { get: vi.fn((k) => env[k]) } },
      ],
    }).compile();

    service = module.get<PaymentQueueService>(PaymentQueueService);
  });

  it('binds the payments queue to the exchange', async () => {
    await service.consumePaymentOrders(vi.fn());

    expect(rabbitMqService.subscribeToQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: 'payment_queue',
        exchange: 'payments',
        routingKey: 'payment.order',
      })
    );
  });

  it('propagates a subscription failure so the caller can retry', async () => {
    const failure = new Error('RabbitMQ channel not available');
    rabbitMqService.subscribeToQueue.mockRejectedValue(failure);

    await expect(service.consumePaymentOrders(vi.fn())).rejects.toThrow(
      failure
    );
  });

  it('routes a delivered message through the given callback', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    await service.consumePaymentOrders(callback);

    const order = makeOrder();
    const subscription = rabbitMqService.subscribeToQueue.mock.calls[0][0];
    await subscription.callback(order);

    expect(callback).toHaveBeenCalledWith(order);
  });
});

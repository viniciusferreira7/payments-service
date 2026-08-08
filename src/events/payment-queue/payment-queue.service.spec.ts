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
    items: [{ productId: 'product-1', quantity: 1, price: 100 }],
    paymentMethod: 'credit_card',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PaymentQueueService', () => {
  let service: PaymentQueueService;
  let rabbitMqService: {
    getChannel: ReturnType<typeof vi.fn>;
    subscribeToQueue: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    rabbitMqService = {
      getChannel: vi.fn().mockReturnValue({}),
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

  it('binds the payments queue to the exchange on init', async () => {
    await service.onModuleInit();

    expect(rabbitMqService.subscribeToQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: 'payment_queue',
        exchange: 'payments',
        routingKey: 'payment.order',
      })
    );
  });

  it('skips the subscription when no channel is available', async () => {
    rabbitMqService.getChannel.mockReturnValue(undefined);

    await service.onModuleInit();

    expect(rabbitMqService.subscribeToQueue).not.toHaveBeenCalled();
  });

  it('routes a delivered message through the handler', async () => {
    const handler = vi
      .spyOn(service, 'handlePaymentOrder')
      .mockResolvedValue(undefined);

    await service.onModuleInit();

    const order = makeOrder();
    const { callback } = rabbitMqService.subscribeToQueue.mock.calls[0][0];
    await callback(order);

    expect(handler).toHaveBeenCalledWith(order);
  });

  it('accepts a valid payment order', async () => {
    await expect(
      service.handlePaymentOrder(makeOrder())
    ).resolves.toBeUndefined();
  });

  it.each([
    ['missing orderId', { orderId: '' }],
    ['missing userId', { userId: '' }],
    ['non-positive amount', { amount: 0 }],
    ['no items', { items: [] }],
  ])('rejects a payment order with %s', async (_label, overrides) => {
    await expect(
      service.handlePaymentOrder(makeOrder(overrides))
    ).rejects.toThrow('Invalid payment order');
  });
});

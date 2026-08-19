import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { PaymentOrderMessage } from '../interfaces/payments-queue.interface';
import { PaymentQueueService } from '../payment-queue/payment-queue.service';
import { PaymentConsumerService } from './payment-consumer.service';

type PaymentOrderHandler = (message: PaymentOrderMessage) => Promise<void>;

/** Keeps the Nest logger quiet while the spies still record every call. */
const silence = () => undefined;

function makeOrder(
  overrides: Partial<PaymentOrderMessage> = {}
): PaymentOrderMessage {
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

describe('PaymentConsumerService', () => {
  let service: PaymentConsumerService;
  let paymentQueueService: {
    consumePaymentOrders: ReturnType<typeof vi.fn>;
  };
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  let debug: ReturnType<typeof vi.spyOn>;

  /**
   * `processPaymentOrder` is private and only reachable through the handler the
   * service hands to the queue on init, so every message-level test drives it
   * through the real registration path.
   */
  async function getRegisteredHandler(): Promise<PaymentOrderHandler> {
    await service.onApplicationBootstrap();

    return paymentQueueService.consumePaymentOrders.mock
      .calls[0][0] as PaymentOrderHandler;
  }

  beforeEach(async () => {
    // Silence + capture the logger: for an invalid message the log is the only
    // observable output the service produces.
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(silence);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(silence);
    debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(silence);

    paymentQueueService = {
      consumePaymentOrders: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentConsumerService,
        { provide: PaymentQueueService, useValue: paymentQueueService },
      ],
    }).compile();

    service = module.get<PaymentConsumerService>(PaymentConsumerService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onApplicationBootstrap', () => {
    it('registers a payment order handler on the queue', async () => {
      await service.onApplicationBootstrap();

      expect(paymentQueueService.consumePaymentOrders).toHaveBeenCalledTimes(1);
      expect(paymentQueueService.consumePaymentOrders).toHaveBeenCalledWith(
        expect.any(Function)
      );
    });

    it('registers a handler already bound to the service instance', async () => {
      const handler = await getRegisteredHandler();

      // Called through a bare reference, with no receiver: an unbound handler
      // would blow up on `this.logger` instead of processing the message.
      await expect(handler(makeOrder())).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith('Payment order received and validated');
    });

    it('subscribes on bootstrap, not on init', () => {
      // `RabbitmqService` opens its channel in `onModuleInit`, and Nest runs
      // those hooks in parallel. Subscribing on init raced that connection.
      expect(service).not.toHaveProperty('onModuleInit');
    });

    it('logs a queue failure without failing the boot', async () => {
      const failure = new Error('broker unreachable');
      paymentQueueService.consumePaymentOrders.mockRejectedValue(failure);

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledWith(
        `Failed to start consuming payment orders: ${failure.message}`,
        failure.stack
      );
    });

    it('logs the raw value when the queue rejects with a non-Error', async () => {
      paymentQueueService.consumePaymentOrders.mockRejectedValue('boom');

      await service.onApplicationBootstrap();

      expect(error).toHaveBeenCalledWith(
        'Failed to start consuming payment orders: boom',
        undefined
      );
    });
  });

  describe('processing a payment order', () => {
    it('accepts a valid message', async () => {
      const handler = await getRegisteredHandler();
      const order = makeOrder();

      await handler(order);

      expect(debug).toHaveBeenCalledWith(
        `Processing payment order: orderId=${order.orderId}, userId=${order.userId}, amount=${order.amount}`
      );
      expect(log).toHaveBeenCalledWith('Payment order received and validated');
      expect(error).not.toHaveBeenCalled();
    });

    it.each([
      [
        'orderId is missing',
        { orderId: '' },
        'Missing orderId in payment message',
      ],
      [
        'userId is missing',
        { userId: '' },
        'Missing userId in payment message',
      ],
      ['amount is zero', { amount: 0 }, 'Invalid amount in payment message'],
      [
        'amount is negative',
        { amount: -1 },
        'Invalid amount in payment message',
      ],
      [
        'paymentMethod is missing',
        { paymentMethod: '' },
        'Missing paymentMethod in payment message',
      ],
      ['items is empty', { items: [] }, 'No items in payment message'],
    ])(
      'rejects the message when %s',
      async (_case, overrides: Partial<PaymentOrderMessage>, reason) => {
        const handler = await getRegisteredHandler();

        await handler(makeOrder(overrides));

        expect(error).toHaveBeenCalledWith(reason);
        expect(error).toHaveBeenCalledWith('Invalid payment message received');
        expect(log).not.toHaveBeenCalledWith(
          'Payment order received and validated'
        );
      }
    );

    it('stops at the first validation failure', async () => {
      const handler = await getRegisteredHandler();

      await handler(makeOrder({ orderId: '', userId: '' }));

      expect(error).toHaveBeenCalledWith('Missing orderId in payment message');
      expect(error).not.toHaveBeenCalledWith(
        'Missing userId in payment message'
      );
    });

    it('does not reject on an invalid message, so it is not requeued forever', async () => {
      const handler = await getRegisteredHandler();

      await expect(
        handler(makeOrder({ orderId: '' }))
      ).resolves.toBeUndefined();
    });

    it('logs and rethrows an unexpected processing failure', async () => {
      const handler = await getRegisteredHandler();
      const failure = new Error('processing exploded');
      debug.mockImplementationOnce(() => {
        throw failure;
      });

      const order = makeOrder();

      await expect(handler(order)).rejects.toThrow(failure);
      expect(error).toHaveBeenCalledWith(
        `Failed to process payment for order: ${order.orderId}, error message:${failure.message}`,
        failure.stack
      );
    });
  });
});

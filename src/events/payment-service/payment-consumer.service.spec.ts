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
    discount: 0,
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

        await expect(handler(makeOrder(overrides))).rejects.toThrow(
          'Invalid payment message received'
        );

        expect(error).toHaveBeenCalledWith(reason);
        expect(error).toHaveBeenCalledWith('Invalid payment message received');
        expect(log).not.toHaveBeenCalledWith(
          'Payment order received and validated'
        );
      }
    );

    it('stops at the first validation failure', async () => {
      const handler = await getRegisteredHandler();

      await expect(
        handler(makeOrder({ orderId: '', userId: '' }))
      ).rejects.toThrow('Invalid payment message received');

      expect(error).toHaveBeenCalledWith('Missing orderId in payment message');
      expect(error).not.toHaveBeenCalledWith(
        'Missing userId in payment message'
      );
    });

    it('rejects an invalid message so the broker routes it to the DLQ', async () => {
      const handler = await getRegisteredHandler();
      const order = makeOrder({ orderId: '' });

      // `RabbitmqService.subscribeToQueue` nacks without requeue when the
      // handler rejects, which is what moves the message onto the DLQ.
      // Resolving here would ack a message that was never processed.
      await expect(handler(order)).rejects.toThrow(
        'Invalid payment message received'
      );

      expect(error).toHaveBeenCalledWith(
        `Failed to process payment for order: ${order.orderId}, error message:Invalid payment message received`,
        expect.any(String)
      );
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

  describe('validating the amount against the order total', () => {
    it('accepts an amount equal to the items total', async () => {
      const handler = await getRegisteredHandler();

      await expect(
        handler(
          makeOrder({
            amount: 130,
            discount: 0,
            items: [
              { productId: 'product-1', quantity: 2, price: 50 },
              { productId: 'product-2', quantity: 1, price: 30 },
            ],
          })
        )
      ).resolves.toBeUndefined();

      expect(log).toHaveBeenCalledWith('Payment order received and validated');
    });

    it('accepts an amount with the discount subtracted from the items total', async () => {
      const handler = await getRegisteredHandler();

      await expect(
        handler(
          makeOrder({
            amount: 80,
            discount: 20,
            items: [{ productId: 'product-1', quantity: 1, price: 100 }],
          })
        )
      ).resolves.toBeUndefined();

      expect(log).toHaveBeenCalledWith('Payment order received and validated');
    });

    it.each([
      ['the amount is below the items total', { amount: 90, discount: 0 }],
      ['the amount is above the items total', { amount: 110, discount: 0 }],
      [
        'the discount was announced but never applied to the amount',
        { amount: 100, discount: 20 },
      ],
      [
        'the discount was applied twice to the amount',
        { amount: 60, discount: 20 },
      ],
      [
        'the discount pushes the total below the charged amount',
        { amount: 100, discount: 100 },
      ],
    ])('rejects the message when %s', async (_case, overrides) => {
      const handler = await getRegisteredHandler();

      await expect(
        handler(
          makeOrder({
            ...overrides,
            items: [{ productId: 'product-1', quantity: 1, price: 100 }],
          })
        )
      ).rejects.toThrow('Invalid payment message received');

      expect(error).toHaveBeenCalledWith(
        'Payment amount does not match order total'
      );
    });

    it('rejects the message when a producer omits the discount', async () => {
      const handler = await getRegisteredHandler();

      // Messages arrive as untyped JSON off the queue, so a producer on an
      // older contract can leave `discount` out entirely. The subtraction then
      // yields NaN, which must fail the check rather than pass it.
      const order = makeOrder();
      Reflect.deleteProperty(order, 'discount');

      await expect(handler(order)).rejects.toThrow(
        'Invalid payment message received'
      );

      expect(error).toHaveBeenCalledWith(
        'Payment amount does not match order total'
      );
    });

    it('checks the items are present before summing them', async () => {
      const handler = await getRegisteredHandler();

      // Reducing an empty list would total 0 and report a mismatch, masking
      // the real problem: the message carries no items at all.
      await expect(handler(makeOrder({ items: [] }))).rejects.toThrow(
        'Invalid payment message received'
      );

      expect(error).toHaveBeenCalledWith('No items in payment message');
      expect(error).not.toHaveBeenCalledWith(
        'Payment amount does not match order total'
      );
    });
  });
});

import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { EnvService } from '@/env/env.service';
import type { SubscribeToQueueRetryOptions } from '../interfaces/subscribe-to-queue.interface';
import { RabbitmqService } from './rabbitmq.service';

// `amqplib` is an ESM namespace here, so `vi.spyOn` cannot redefine `connect`.
const { amqpConnect } = vi.hoisted(() => ({ amqpConnect: vi.fn() }));
vi.mock('amqplib', () => ({ connect: amqpConnect }));

/** Keeps the Nest logger quiet while the spies still record every call. */
const silence = () => undefined;

/** Minimal `amqp.Channel` stub: enough surface for the topology + consume. */
function makeChannel() {
  return {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn(async (queue: string) => ({ queue })),
    bindQueue: vi.fn().mockResolvedValue(undefined),
    prefetch: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn().mockResolvedValue({ consumerTag: 'consumer-1' }),
    publish: vi.fn().mockReturnValue(true),
    ack: vi.fn(),
    nack: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/** A queue callback typed as `SubscribeToQueue` declares it. */
function makeCallback() {
  return vi.fn<(message: unknown) => Promise<void>>();
}

/** An AMQP delivery carrying `payload` as its JSON body. */
function makeMessage(payload: unknown, headers: Record<string, unknown> = {}) {
  return {
    content: Buffer.from(JSON.stringify(payload)),
    properties: { headers },
  };
}

/**
 * The `x-death` header the broker stamps on a message. One entry per queue the
 * message died in, `count` being how many times it died there.
 */
function xDeath(entries: Array<{ queue: string; count?: number }>) {
  return { 'x-death': entries };
}

describe('RabbitmqService', () => {
  let service: RabbitmqService;

  beforeEach(async () => {
    // `RabbitmqService` injects `EnvService`, so the container needs it to
    // resolve. `compile()` does not run `onModuleInit`, so no AMQP connection
    // is opened here — this stays a unit test with no broker.
    const envService = {
      get: vi.fn().mockReturnValue('amqp://test:test@localhost:5672'),
      rabbitmqUrl: 'amqp://test:test@localhost:5672',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RabbitmqService,
        { provide: EnvService, useValue: envService },
      ],
    }).compile();

    service = module.get<RabbitmqService>(RabbitmqService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    const DEFAULT_MAX_ATTEMPT = 10;
    const CONNECT_WINDOW_MS = DEFAULT_MAX_ATTEMPT * 500;

    let createChannel: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      createChannel = vi.fn().mockResolvedValue({});
      amqpConnect.mockReset();
      amqpConnect.mockResolvedValue({ createChannel });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('connects on the first attempt when the broker is up', async () => {
      const init = service.onModuleInit();
      await vi.advanceTimersByTimeAsync(CONNECT_WINDOW_MS);
      await init;

      expect(amqpConnect).toHaveBeenCalledTimes(1);
      expect(service.getChannel()).toBeDefined();
    });

    it('retries until the broker accepts the connection', async () => {
      amqpConnect
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue({ createChannel });

      const init = service.onModuleInit();
      await vi.advanceTimersByTimeAsync(CONNECT_WINDOW_MS);
      await init;

      expect(amqpConnect).toHaveBeenCalledTimes(3);
      expect(service.getChannel()).toBeDefined();
    });

    it('gives up after the retry window without failing the boot', async () => {
      const error = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      amqpConnect.mockRejectedValue(new Error('ECONNREFUSED'));

      const init = service.onModuleInit();
      await vi.advanceTimersByTimeAsync(CONNECT_WINDOW_MS);

      await expect(init).resolves.toBeUndefined();
      expect(amqpConnect).toHaveBeenCalledTimes(DEFAULT_MAX_ATTEMPT);
      expect(error).toHaveBeenCalledWith(
        'Gave up connecting to RabbitMQ: broker unreachable'
      );
    });

    it('reuses an open connection when only the channel failed', async () => {
      createChannel
        .mockRejectedValueOnce(new Error('channel error'))
        .mockResolvedValue({});

      const init = service.onModuleInit();
      await vi.advanceTimersByTimeAsync(CONNECT_WINDOW_MS);
      await init;

      // Second attempt must not open a second connection.
      expect(amqpConnect).toHaveBeenCalledTimes(1);
      expect(createChannel).toHaveBeenCalledTimes(2);
      expect(service.getChannel()).toBeDefined();
    });
  });

  describe('subscribeToQueue', () => {
    const subscription = {
      queueName: 'payment_queue',
      exchange: 'payments',
      routingKey: 'payment.order',
      callback: vi.fn(),
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('rejects when the broker was never reached', async () => {
      // `connect()` logs and returns on failure, leaving `channel` undefined.
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.subscribeToQueue(subscription)).rejects.toThrow(
        'RabbitMQ channel not available'
      );
    });

    it('logs and rethrows a broker failure', async () => {
      const error = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const failure = new Error('channel closed');

      Reflect.set(service, 'channel', {
        assertExchange: vi.fn().mockRejectedValue(failure),
      });

      await expect(service.subscribeToQueue(subscription)).rejects.toThrow(
        failure
      );
      expect(error).toHaveBeenCalledWith(
        `Error subscribing to queue ${subscription.queueName}: ${failure.message}`,
        failure.stack
      );
    });
  });

  describe('subscribeToQueue topology', () => {
    const subscription = {
      queueName: 'payment_queue',
      exchange: 'payments',
      routingKey: 'payment.order',
    };

    let channel: ReturnType<typeof makeChannel>;
    let callback: ReturnType<typeof makeCallback>;

    beforeEach(() => {
      vi.spyOn(Logger.prototype, 'log').mockImplementation(silence);
      vi.spyOn(Logger.prototype, 'debug').mockImplementation(silence);
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(silence);
      vi.spyOn(Logger.prototype, 'error').mockImplementation(silence);

      channel = makeChannel();
      callback = makeCallback();
      callback.mockResolvedValue(undefined);
      Reflect.set(service, 'channel', channel);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('declares the main exchange as a durable topic', async () => {
      await service.subscribeToQueue({ ...subscription, callback });

      expect(channel.assertExchange).toHaveBeenCalledWith('payments', 'topic', {
        durable: true,
      });
    });

    it('declares a dead letter exchange alongside the main one', async () => {
      await service.subscribeToQueue({ ...subscription, callback });

      expect(channel.assertExchange).toHaveBeenCalledWith(
        'payments.dlx',
        'topic',
        { durable: true }
      );
    });

    it('declares the dead letter queue and binds it to the DLX', async () => {
      await service.subscribeToQueue({ ...subscription, callback });

      expect(channel.assertQueue).toHaveBeenCalledWith('payment_queue.dlq', {
        durable: true,
        arguments: expect.objectContaining({ 'x-message-tll': 604_800_000 }),
      });
      expect(channel.bindQueue).toHaveBeenCalledWith(
        'payment_queue.dlq',
        'payments.dlx',
        'payment.order.dlq'
      );
    });

    it('declares a retry exchange alongside the main one', async () => {
      await service.subscribeToQueue({ ...subscription, callback });

      expect(channel.assertExchange).toHaveBeenCalledWith(
        'payments.retry.dlx',
        'topic',
        { durable: true }
      );
    });

    it('parks retried messages in a TTL queue that expires back to the main exchange', async () => {
      await service.subscribeToQueue({ ...subscription, callback });

      // The retry queue has no consumer: the delay is the TTL, and expiry is
      // what dead-letters the message back onto the main exchange.
      expect(channel.assertQueue).toHaveBeenCalledWith('payment_queue.retry', {
        durable: true,
        arguments: {
          'x-message-ttl': 30_000,
          'x-dead-letter-exchange': 'payments',
          'x-dead-letter-routing-key': 'payment.order',
        },
      });
      expect(channel.bindQueue).toHaveBeenCalledWith(
        'payment_queue.retry',
        'payments.retry.dlx',
        'payment.order.retry'
      );
    });

    it('uses the configured retry delay as the retry queue TTL', async () => {
      await service.subscribeToQueue({
        ...subscription,
        callback,
        options: { maxRetries: 5, retryDelayMs: 5_000 },
      });

      expect(channel.assertQueue).toHaveBeenCalledWith(
        'payment_queue.retry',
        expect.objectContaining({
          arguments: expect.objectContaining({ 'x-message-ttl': 5_000 }),
        })
      );
    });

    it('points the main queue at the retry exchange', async () => {
      await service.subscribeToQueue({ ...subscription, callback });

      // A nack on the main queue must land on the retry side, not the DLQ —
      // the DLQ is reached explicitly, once the retries are spent.
      expect(channel.assertQueue).toHaveBeenCalledWith('payment_queue', {
        durable: true,
        arguments: {
          'x-message-ttl': 86_400_000,
          'x-max-length': 10_000,
          'x-dead-letter-exchange': 'payments.retry.dlx',
          'x-dead-letter-routing-key': 'payment.order.retry',
        },
      });
    });

    it('declares the retry and dead letter queues before the queue that routes to them', async () => {
      await service.subscribeToQueue({ ...subscription, callback });

      const declared = channel.assertQueue.mock.calls.map(([name]) => name);

      // Publishing to a missing exchange/queue silently drops the message, so
      // both sides have to exist before the main queue can name them.
      expect(declared).toEqual([
        'payment_queue.retry',
        'payment_queue.dlq',
        'payment_queue',
      ]);
    });

    it('binds the main queue to its routing key and consumes one at a time', async () => {
      await service.subscribeToQueue({ ...subscription, callback });

      expect(channel.bindQueue).toHaveBeenCalledWith(
        'payment_queue',
        'payments',
        'payment.order'
      );
      expect(channel.prefetch).toHaveBeenCalledWith(1);
      expect(channel.consume).toHaveBeenCalledWith(
        'payment_queue',
        expect.any(Function)
      );
    });
  });

  describe('consuming a delivered message', () => {
    const subscription = {
      queueName: 'payment_queue',
      exchange: 'payments',
      routingKey: 'payment.order',
    };

    let channel: ReturnType<typeof makeChannel>;
    let callback: ReturnType<typeof makeCallback>;
    let warn: ReturnType<typeof vi.spyOn>;
    let error: ReturnType<typeof vi.spyOn>;

    /** Returns the consumer the service handed to `channel.consume`. */
    async function getConsumer() {
      await service.subscribeToQueue({ ...subscription, callback });

      return channel.consume.mock.calls[0][1] as (
        message: { content: Buffer } | null
      ) => Promise<void>;
    }

    beforeEach(() => {
      vi.spyOn(Logger.prototype, 'log').mockImplementation(silence);
      vi.spyOn(Logger.prototype, 'debug').mockImplementation(silence);
      warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(silence);
      error = vi.spyOn(Logger.prototype, 'error').mockImplementation(silence);

      channel = makeChannel();
      callback = makeCallback();
      callback.mockResolvedValue(undefined);
      Reflect.set(service, 'channel', channel);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('parses the payload and hands it to the callback', async () => {
      const consumer = await getConsumer();
      const payload = { orderId: 'order-1', amount: 100 };

      await consumer(makeMessage(payload));

      expect(callback).toHaveBeenCalledWith(payload);
    });

    it('acks a message the callback processed', async () => {
      const consumer = await getConsumer();
      const message = makeMessage({ orderId: 'order-1' });

      await consumer(message);

      expect(channel.ack).toHaveBeenCalledWith(message);
      expect(channel.nack).not.toHaveBeenCalled();
    });

    it('nacks a message the callback rejected onto the retry path', async () => {
      const failure = new Error('Invalid payment message received');
      callback.mockRejectedValue(failure);

      const consumer = await getConsumer();
      const message = makeMessage({ orderId: 'order-1' });

      await consumer(message);

      // `requeue: false` is what hands the message to the queue's dead letter
      // exchange — here the retry exchange; requeueing it would spin the same
      // failing message with no delay.
      expect(channel.nack).toHaveBeenCalledWith(message, false, false);
      expect(channel.ack).not.toHaveBeenCalled();
      expect(channel.publish).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        `Error to processing message: ${failure.message}`,
        failure.stack
      );
      expect(warn).toHaveBeenCalledWith(
        'Processing failed (attempt 1/4)Retrying in 30s'
      );
    });

    it('sends a malformed payload down the retry path without calling the callback', async () => {
      const consumer = await getConsumer();
      const message = { content: Buffer.from('not json') };

      await consumer(message);

      expect(callback).not.toHaveBeenCalled();
      expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    });

    it('does not fail the consumer when the message is nacked', async () => {
      callback.mockRejectedValue(new Error('boom'));

      const consumer = await getConsumer();

      // The consumer swallows the failure so the channel keeps delivering.
      await expect(consumer(makeMessage({}))).resolves.toBeUndefined();
    });

    it('warns and stops when the broker cancels the consumer', async () => {
      const consumer = await getConsumer();

      await consumer(null);

      expect(warn).toHaveBeenCalledWith(
        'Consumer for queue payment_queue was cancelled'
      );
      expect(callback).not.toHaveBeenCalled();
      expect(channel.ack).not.toHaveBeenCalled();
      expect(channel.nack).not.toHaveBeenCalled();
    });
  });

  describe('retrying and exhausting a failed message', () => {
    const subscription = {
      queueName: 'payment_queue',
      exchange: 'payments',
      routingKey: 'payment.order',
    };

    let channel: ReturnType<typeof makeChannel>;
    let callback: ReturnType<typeof makeCallback>;
    let log: ReturnType<typeof vi.spyOn>;
    let warn: ReturnType<typeof vi.spyOn>;
    let error: ReturnType<typeof vi.spyOn>;

    /** Returns the consumer the service handed to `channel.consume`. */
    async function getConsumer(options: SubscribeToQueueRetryOptions = {}) {
      await service.subscribeToQueue({ ...subscription, callback, options });

      return channel.consume.mock.calls[0][1] as (
        message: ReturnType<typeof makeMessage> | null
      ) => Promise<void>;
    }

    beforeEach(() => {
      log = vi.spyOn(Logger.prototype, 'log').mockImplementation(silence);
      vi.spyOn(Logger.prototype, 'debug').mockImplementation(silence);
      warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(silence);
      error = vi.spyOn(Logger.prototype, 'error').mockImplementation(silence);

      channel = makeChannel();
      callback = makeCallback();
      // Every message in this block fails: what is under test is where it goes.
      callback.mockRejectedValue(new Error('gateway unavailable'));
      Reflect.set(service, 'channel', channel);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('counts a delivery with no x-death header as the first attempt', async () => {
      const consumer = await getConsumer();

      await consumer(makeMessage({ orderId: 'order-1' }));

      expect(log).toHaveBeenCalledWith('Message received (attempt 1/3)');
      expect(channel.nack).toHaveBeenCalled();
    });

    it('counts an empty x-death header as the first attempt', async () => {
      const consumer = await getConsumer();

      await consumer(makeMessage({ orderId: 'order-1' }, xDeath([])));

      expect(log).toHaveBeenCalledWith('Message received (attempt 1/3)');
    });

    it('counts the deaths the main queue recorded', async () => {
      const consumer = await getConsumer();

      await consumer(
        makeMessage(
          { orderId: 'order-1' },
          xDeath([{ queue: 'payment_queue', count: 2 }])
        )
      );

      expect(log).toHaveBeenCalledWith('Message received (attempt 3/3)');
      expect(warn).toHaveBeenCalledWith(
        'Processing failed (attempt 3/4)Retrying in 30s'
      );
      expect(channel.nack).toHaveBeenCalled();
    });

    it('ignores the deaths the retry queue recorded', async () => {
      const consumer = await getConsumer();

      // A round trip stamps two entries: one for the main queue (the nack) and
      // one for the retry queue (the TTL expiry). Only the first is an attempt
      // — counting both would burn the budget twice as fast.
      await consumer(
        makeMessage(
          { orderId: 'order-1' },
          xDeath([
            { queue: 'payment_queue', count: 1 },
            { queue: 'payment_queue.retry', count: 1 },
          ])
        )
      );

      expect(log).toHaveBeenCalledWith('Message received (attempt 2/3)');
      expect(channel.nack).toHaveBeenCalled();
      expect(channel.publish).not.toHaveBeenCalled();
    });

    it('tolerates a death entry with no count', async () => {
      const consumer = await getConsumer();

      await consumer(
        makeMessage(
          { orderId: 'order-1' },
          xDeath([{ queue: 'payment_queue' }])
        )
      );

      expect(log).toHaveBeenCalledWith('Message received (attempt 1/3)');
    });

    it('publishes to the dead letter exchange once the retries are spent', async () => {
      const consumer = await getConsumer();
      const message = makeMessage(
        { orderId: 'order-1' },
        xDeath([{ queue: 'payment_queue', count: 3 }])
      );

      await consumer(message);

      // The DLQ is reached by an explicit publish, not by a nack: nacking here
      // would send the message round the retry loop again.
      expect(channel.publish).toHaveBeenCalledWith(
        'payments.dlx',
        'payment.order.dlq',
        message.content,
        { persistent: true, headers: message.properties.headers }
      );
      expect(channel.nack).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        'Max retries (3) exceeded. Sending to DLQ.'
      );
    });

    it('acks the message it parked in the DLQ', async () => {
      const consumer = await getConsumer();
      const message = makeMessage(
        { orderId: 'order-1' },
        xDeath([{ queue: 'payment_queue', count: 3 }])
      );

      await consumer(message);

      // Without the ack the message stays unacked on the main queue and comes
      // back on the next channel recovery — now duplicated in the DLQ.
      expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it('carries the x-death history into the DLQ message', async () => {
      const consumer = await getConsumer();
      const headers = xDeath([
        { queue: 'payment_queue', count: 3 },
        { queue: 'payment_queue.retry', count: 3 },
      ]);

      await consumer(makeMessage({ orderId: 'order-1' }, headers));

      // The history is the only record of why the message ended up here.
      expect(channel.publish).toHaveBeenCalledWith(
        'payments.dlx',
        'payment.order.dlq',
        expect.any(Buffer),
        expect.objectContaining({ headers })
      );
    });

    it('honours a lower retry budget', async () => {
      const consumer = await getConsumer({
        maxRetries: 1,
        retryDelayMs: 1_000,
      });

      await consumer(
        makeMessage(
          { orderId: 'order-1' },
          xDeath([{ queue: 'payment_queue', count: 1 }])
        )
      );

      expect(error).toHaveBeenCalledWith(
        'Max retries (1) exceeded. Sending to DLQ.'
      );
      expect(channel.publish).toHaveBeenCalled();
      expect(channel.nack).not.toHaveBeenCalled();
    });

    it('keeps retrying while the budget allows it', async () => {
      const consumer = await getConsumer({
        maxRetries: 5,
        retryDelayMs: 1_000,
      });

      await consumer(
        makeMessage(
          { orderId: 'order-1' },
          xDeath([{ queue: 'payment_queue', count: 4 }])
        )
      );

      expect(warn).toHaveBeenCalledWith(
        'Processing failed (attempt 5/6)Retrying in 1s'
      );
      expect(channel.nack).toHaveBeenCalled();
      expect(channel.publish).not.toHaveBeenCalled();
    });

    it('does not fail the consumer when the message is dead lettered', async () => {
      const consumer = await getConsumer();

      // The consumer swallows the failure so the channel keeps delivering.
      await expect(
        consumer(
          makeMessage(
            { orderId: 'order-1' },
            xDeath([{ queue: 'payment_queue', count: 3 }])
          )
        )
      ).resolves.toBeUndefined();
    });
  });

  describe('publicMessage', () => {
    const params = {
      exchange: 'payments',
      routingKey: 'payment.order',
      message: { orderId: 'order-1', amount: 100 },
    };

    let channel: ReturnType<typeof makeChannel>;
    let warn: ReturnType<typeof vi.spyOn>;
    let error: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.spyOn(Logger.prototype, 'log').mockImplementation(silence);
      vi.spyOn(Logger.prototype, 'debug').mockImplementation(silence);
      warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(silence);
      error = vi.spyOn(Logger.prototype, 'error').mockImplementation(silence);

      channel = makeChannel();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('skips the publish when the broker was never reached', async () => {
      await expect(service.publicMessage(params)).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith(
        'RabbiMq channel not available, skipping message publish'
      );
    });

    it('publishes the message as a durable JSON payload', async () => {
      Reflect.set(service, 'channel', channel);

      await service.publicMessage(params);

      expect(channel.assertExchange).toHaveBeenCalledWith('payments', 'topic', {
        durable: true,
      });

      const [exchange, routingKey, content, options] =
        channel.publish.mock.calls[0];

      expect(exchange).toBe('payments');
      expect(routingKey).toBe('payment.order');
      expect(JSON.parse(content.toString('utf-8'))).toEqual(params.message);
      expect(options).toMatchObject({
        persistent: true,
        contentType: 'application/json',
      });
    });

    it('logs a full write buffer instead of throwing at the caller', async () => {
      // `publish` returning false means the write buffer is full; the service
      // must not surface that to the caller.
      channel.publish.mockReturnValue(false);
      Reflect.set(service, 'channel', channel);

      await expect(service.publicMessage(params)).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(
        'Error publishing message to RabbitMQ: Failed to publish message to RabbiMQ',
        expect.any(String)
      );
    });

    it('logs a broker failure instead of throwing at the caller', async () => {
      const failure = new Error('channel closed');
      channel.assertExchange.mockRejectedValue(failure);
      Reflect.set(service, 'channel', channel);

      await expect(service.publicMessage(params)).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(
        `Error publishing message to RabbitMQ: ${failure.message}`,
        failure.stack
      );
      expect(channel.publish).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    let log: ReturnType<typeof vi.spyOn>;
    let error: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      log = vi.spyOn(Logger.prototype, 'log').mockImplementation(silence);
      error = vi.spyOn(Logger.prototype, 'error').mockImplementation(silence);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('closes the channel before the connection', async () => {
      const order: string[] = [];
      const channel = {
        close: vi.fn(async () => {
          order.push('channel');
        }),
      };
      const connection = {
        close: vi.fn(async () => {
          order.push('connection');
        }),
      };

      Reflect.set(service, 'channel', channel);
      Reflect.set(service, 'connection', connection);

      await service.onModuleDestroy();

      expect(order).toEqual(['channel', 'connection']);
      expect(log).toHaveBeenCalledWith('RabbitMQ channel service was closed');
      expect(log).toHaveBeenCalledWith('RabbitMQ service was disconnected');
    });

    it('is a no-op when the broker was never reached', async () => {
      // Shutting down after a failed boot must not throw on an absent channel.
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();

      expect(error).not.toHaveBeenCalled();
    });

    it('logs a failure to close instead of failing the shutdown', async () => {
      const failure = new Error('socket already gone');

      Reflect.set(service, 'channel', {
        close: vi.fn().mockRejectedValue(failure),
      });

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(
        `Failed to disconnect from RabbitMQ: ${failure.message}`,
        failure.stack
      );
    });
  });
});

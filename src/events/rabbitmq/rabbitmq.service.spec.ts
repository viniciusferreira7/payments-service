import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { EnvService } from '@/env/env.service';
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
function makeMessage(payload: unknown) {
  return { content: Buffer.from(JSON.stringify(payload)) };
}

describe('RabbitmqService', () => {
  let service: RabbitmqService;

  beforeEach(async () => {
    // `RabbitmqService` injects `EnvService`, so the container needs it to
    // resolve. `compile()` does not run `onModuleInit`, so no AMQP connection
    // is opened here — this stays a unit test with no broker.
    const envService = {
      get: vi.fn().mockReturnValue('amqp://test:test@localhost:5672'),
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

    it('points the main queue at the dead letter exchange', async () => {
      await service.subscribeToQueue({ ...subscription, callback });

      expect(channel.assertQueue).toHaveBeenCalledWith('payment_queue', {
        durable: true,
        arguments: {
          'x-message-ttl': 86_400_000,
          'x-max-length': 10_000,
          'x-dead-letter-exchange': 'payments.dlx',
          'x-dead-letter-routing-key': 'payment.order.dlq',
        },
      });
    });

    it('declares the dead letter queue before the queue that routes to it', async () => {
      await service.subscribeToQueue({ ...subscription, callback });

      const declared = channel.assertQueue.mock.calls.map(([name]) => name);

      // Publishing to a missing DLX/DLQ silently drops the message, so the
      // dead letter side has to exist before the main queue can name it.
      expect(declared).toEqual(['payment_queue.dlq', 'payment_queue']);
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

    it('sends a message to the DLQ when the callback rejects', async () => {
      const failure = new Error('Invalid payment message received');
      callback.mockRejectedValue(failure);

      const consumer = await getConsumer();
      const message = makeMessage({ orderId: 'order-1' });

      await consumer(message);

      // `requeue: false` is what routes the message to the DLQ; requeueing it
      // would loop the same poison message forever.
      expect(channel.nack).toHaveBeenCalledWith(message, false, false);
      expect(channel.ack).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        `Error to processing message: ${failure.message}`,
        failure.stack
      );
      expect(warn).toHaveBeenCalledWith(
        'This message sent to DLQ: payment_queue.dlq'
      );
    });

    it('sends a malformed payload to the DLQ without calling the callback', async () => {
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

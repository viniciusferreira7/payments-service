import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { EnvService } from '@/env/env.service';
import { RabbitmqService } from './rabbitmq.service';

// `amqplib` is an ESM namespace here, so `vi.spyOn` cannot redefine `connect`.
const { amqpConnect } = vi.hoisted(() => ({ amqpConnect: vi.fn() }));
vi.mock('amqplib', () => ({ connect: amqpConnect }));

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
});

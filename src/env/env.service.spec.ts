import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvService } from './env.service';

describe('EnvService', () => {
  let service: EnvService;
  let configService: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    configService = { get: vi.fn().mockReturnValue('value') };
    service = new EnvService(configService as never);
  });

  it('delegates to the ConfigService with type inference', () => {
    const result = service.get('JWT_SECRET');

    expect(result).toBe('value');
    expect(configService.get).toHaveBeenCalledWith('JWT_SECRET', {
      infer: true,
    });
  });

  describe('rabbitmqUrl', () => {
    /** Answers each key from `env`, the way ConfigService would. */
    function withEnv(env: Record<string, string>): EnvService {
      return new EnvService({
        get: vi.fn((key: string) => env[key]),
      } as never);
    }

    it('reads the test broker under NODE_ENV=test', () => {
      const url = withEnv({
        NODE_ENV: 'test',
        RABBITMQ_URL: 'amqp://admin:admin@localhost:5672',
        RABBITMQ_TEST_URL: 'amqp://test:test@localhost:5673',
      }).rabbitmqUrl;

      expect(url).toBe('amqp://test:test@localhost:5673');
    });

    it('reads the configured broker everywhere else', () => {
      for (const nodeEnv of ['dev', 'production']) {
        const url = withEnv({
          NODE_ENV: nodeEnv,
          RABBITMQ_URL: 'amqp://admin:admin@localhost:5672',
          RABBITMQ_TEST_URL: 'amqp://test:test@localhost:5673',
        }).rabbitmqUrl;

        expect(url).toBe('amqp://admin:admin@localhost:5672');
      }
    });
  });
});

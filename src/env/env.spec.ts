import { describe, expect, it } from 'vitest';
import { envSchema } from './env';

const baseEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5433/payments',
  DATABASE_USERNAME: 'user',
  DATABASE_PASSWORD: 'pass',
  DATABASE_NAME: 'payments',
  JWT_SECRET: 'secret',
  JWT_EXPIRES_IN: '1s',
  RABBITMQ_URL: 'amqp://admin:admin@localhost:5672',
  RABBITMQ_QUEUE_PAYMENTS: 'payment_queue',
  RABBITMQ_EXCHANGE: 'payments',
  OTEL_SERVICE_NAME: 'payments-service',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
  PAYMENT_GATEWAY_URL: 'https://example.com',
  PAYMENT_GATEWAY_API_KEY: 'GHGS*bkjg7fvfVlkjknl_kljdsfuihgiuas15dVy',
};

describe('envSchema', () => {
  it('applies the NODE_ENV, PORT and LOG_LEVEL defaults', () => {
    const env = envSchema.parse(baseEnv);

    expect(env.NODE_ENV).toBe('dev');
    expect(env.PORT).toBe(3335);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('defaults the payment order routing key', () => {
    expect(envSchema.parse(baseEnv).RABBITMQ_ROUTING_KEY_PAYMENT_ORDER).toBe(
      'payment.order'
    );
  });

  it('coerces PORT from a string', () => {
    const env = envSchema.parse({ ...baseEnv, PORT: '4000' });

    expect(env.PORT).toBe(4000);
  });

  it('accepts a postgres connection string', () => {
    expect(envSchema.parse(baseEnv).DATABASE_URL).toBe(baseEnv.DATABASE_URL);
  });

  it('accepts an amqp connection string', () => {
    expect(envSchema.parse(baseEnv).RABBITMQ_URL).toBe(baseEnv.RABBITMQ_URL);
  });

  it('defaults the test broker url', () => {
    expect(envSchema.parse(baseEnv).RABBITMQ_TEST_URL).toBe(
      'amqp://test:test@localhost:5673'
    );
  });

  it('accepts an explicit test broker url', () => {
    const env = envSchema.parse({
      ...baseEnv,
      RABBITMQ_TEST_URL: 'amqp://test:test@broker:5674',
    });

    expect(env.RABBITMQ_TEST_URL).toBe('amqp://test:test@broker:5674');
  });

  it('rejects an invalid RABBITMQ_TEST_URL', () => {
    expect(() =>
      envSchema.parse({ ...baseEnv, RABBITMQ_TEST_URL: 'not-a-url' })
    ).toThrow();
  });

  it('rejects an invalid RABBITMQ_URL', () => {
    expect(() =>
      envSchema.parse({ ...baseEnv, RABBITMQ_URL: 'not-a-url' })
    ).toThrow();
  });

  it('rejects an empty RABBITMQ_QUEUE_PAYMENTS', () => {
    expect(() =>
      envSchema.parse({ ...baseEnv, RABBITMQ_QUEUE_PAYMENTS: '' })
    ).toThrow();
  });

  it('rejects an empty RABBITMQ_EXCHANGE', () => {
    expect(() =>
      envSchema.parse({ ...baseEnv, RABBITMQ_EXCHANGE: '' })
    ).toThrow();
  });

  it('rejects an empty JWT_SECRET', () => {
    expect(() => envSchema.parse({ ...baseEnv, JWT_SECRET: '' })).toThrow();
  });

  it('rejects an empty JWT_EXPIRES_IN', () => {
    expect(() => envSchema.parse({ ...baseEnv, JWT_EXPIRES_IN: '' })).toThrow();
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() =>
      envSchema.parse({ ...baseEnv, NODE_ENV: 'staging' })
    ).toThrow();
  });

  it('rejects an unknown PAYMENT_GATEWAY_URL', () => {
    expect(() =>
      envSchema.parse({ ...baseEnv, PAYMENT_GATEWAY_URL: '' })
    ).toThrow();
  });

  it('rejects an unknown PAYMENT_GATEWAY_API_KEY', () => {
    expect(() =>
      envSchema.parse({ ...baseEnv, PAYMENT_GATEWAY_API_KEY: '' })
    ).toThrow();
  });
});

/**
 * Environment defaults for the lanes that boot the Nest application
 * (integration and e2e). `.env.test` is gitignored, so without this a fresh
 * clone or a CI run would fail the Zod validation in `src/env/env.ts`.
 *
 * These are throwaway values — never put real credentials here. Anything
 * already present in `process.env` wins, so CI can override any of them.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3335',
  DATABASE_URL: 'postgres://test:test@localhost:5432/payments_test',
  DATABASE_USERNAME: 'test',
  DATABASE_PASSWORD: 'test',
  DATABASE_NAME: 'payments_test',
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '1d',
  RABBITMQ_URL: 'amqp://test:test@localhost:5672',
  RABBITMQ_QUEUE_PAYMENTS: 'payment_queue',
  RABBITMQ_EXCHANGE: 'payments',
  RABBITMQ_ROUTING_KEY_PAYMENT_ORDER: 'payment.order',
  // `NODE_ENV=test` disables the signals SDK, so nothing is exported. These
  // only exist to satisfy the Zod schema.
  OTEL_SERVICE_NAME: 'payments-service',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}

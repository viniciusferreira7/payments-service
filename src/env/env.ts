import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['dev', 'test', 'production']).default('dev'),
  PORT: z.coerce.number().default(3335),

  DATABASE_URL: z.string(),
  DATABASE_PORT: z.coerce.number().default(5432),
  DATABASE_USERNAME: z.string(),
  DATABASE_PASSWORD: z.string(),
  DATABASE_NAME: z.string(),

  JWT_SECRET: z.string().min(1),
  JWT_EXPIRES_IN: z.string().min(2),

  RABBITMQ_URL: z.url(),
  RABBITMQ_QUEUE_PAYMENTS: z.string().min(1),
  RABBITMQ_EXCHANGE: z.string().min(1),
  RABBITMQ_ROUTING_KEY_PAYMENT_ORDER: z
    .string()
    .min(1)
    .default('payment.order'),

  OTEL_SERVICE_NAME: z.string().min(1),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
});

export type Env = z.infer<typeof envSchema>;

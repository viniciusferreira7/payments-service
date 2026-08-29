import type { Env } from '@/env/env';
import { envSchema } from '@/env/env';
import type { EnvService } from '@/env/env.service';

/**
 * An `EnvService` answering with the validated environment, with `overrides`
 * layered on top.
 *
 * `ConfigModule.forRoot` runs when `app.module.ts` is first imported, so a spec
 * cannot change what the container reads by assigning to `process.env` in a
 * hook — it is already too late. Overriding the provider is the seam that
 * still works:
 *
 * ```ts
 * builder.overrideProvider(EnvService).useValue(
 *   makeEnvService({ RABBITMQ_QUEUE_PAYMENTS: 'payment_queue_spec' })
 * );
 * ```
 */
export function makeEnvService(overrides: Partial<Env> = {}): EnvService {
  const env: Env = { ...envSchema.parse(process.env), ...overrides };

  return {
    get: <T extends keyof Env>(key: T) => env[key],
  } as EnvService;
}

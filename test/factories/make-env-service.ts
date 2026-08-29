import type { ConfigService } from '@nestjs/config';
import type { Env } from '@/env/env';
import { envSchema } from '@/env/env';
import { EnvService } from '@/env/env.service';

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

  // A real `EnvService` over a stub `ConfigService`, so everything it derives
  // from the environment — `rabbitmqUrl`, and whatever is added next — answers
  // from these values rather than having to be re-stubbed here.
  const configService = {
    get: <T extends keyof Env>(key: T) => env[key],
  } as ConfigService<Env, true>;

  return new EnvService(configService);
}

import type { ConfigService } from '@nestjs/config';
import type { Env } from '@/env/env';
import { envSchema } from '@/env/env';
import { EnvService } from '@/env/env.service';

export function makeEnvService(overrides: Partial<Env> = {}): EnvService {
  const env: Env = { ...envSchema.parse(process.env), ...overrides };

  const configService = {
    get: <T extends keyof Env>(key: T) => env[key],
  } as ConfigService<Env, true>;

  return new EnvService(configService);
}

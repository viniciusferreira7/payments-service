import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Env } from './env';

@Injectable()
export class EnvService {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  // The return type is pinned to `Env[T]`: `ConfigService.get`'s own generic
  // is the *value* type, so passing the key type through it widened every
  // lookup to a string and lost the numbers the Zod schema coerces.
  get<T extends keyof Env>(key: T): Env[T] {
    return this.configService.get(key, { infer: true }) as Env[T];
  }

  get rabbitmqUrl(): string {
    return this.get('NODE_ENV') === 'test'
      ? this.get('RABBITMQ_TEST_URL')
      : this.get('RABBITMQ_URL');
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Env } from './env';

@Injectable()
export class EnvService {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  get<T extends keyof Env>(key: T) {
    return this.configService.get<T>(key, { infer: true });
  }

  /**
   * The broker to connect to. Under `NODE_ENV=test` that is the throwaway
   * broker in `RABBITMQ_TEST_URL`: the test lanes declare, purge and delete
   * queues, which has no business happening on the shared broker.
   */
  get rabbitmqUrl(): string {
    return this.get('NODE_ENV') === 'test'
      ? this.get('RABBITMQ_TEST_URL')
      : this.get('RABBITMQ_URL');
  }
}

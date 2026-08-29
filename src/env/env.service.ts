import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Env } from './env';

@Injectable()
export class EnvService {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  get<T extends keyof Env>(key: T) {
    return this.configService.get<T>(key, { infer: true });
  }

  get rabbitmqUrl(): string {
    return this.get('NODE_ENV') === 'test'
      ? this.get('RABBITMQ_TEST_URL')
      : this.get('RABBITMQ_URL');
  }
}

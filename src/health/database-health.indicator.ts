import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export const DATABASE_CHECK_TIMEOUT_MS = 2000;

export type DatabaseHealth = {
  status: 'up' | 'down';
  responseTime: number;
};

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Database check timed out after ${ms}ms`)),
        ms
      );
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

@Injectable()
export class DatabaseHealthIndicator {
  private readonly logger = new Logger(DatabaseHealthIndicator.name);

  constructor(private readonly dataSource: DataSource) {}

  async check(): Promise<DatabaseHealth> {
    const startedAt = Date.now();

    try {
      await withTimeout(
        this.dataSource.query('SELECT 1'),
        DATABASE_CHECK_TIMEOUT_MS
      );

      return {
        status: 'up',
        responseTime: Date.now() - startedAt,
      };
    } catch (err) {
      this.logger.error({ err }, '[Health] database check failed');

      return {
        status: 'down',
        responseTime: Date.now() - startedAt,
      };
    }
  }
}

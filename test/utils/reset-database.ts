import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { assertTestDatabase } from './assert-test-database';

/**
 * Drops and recreates every table. The test lanes run with `synchronize`
 * off, so specs that touch tables call this first — and only ever against a
 * `*_test` database.
 */
export async function resetDatabase(
  app: INestApplication
): Promise<DataSource> {
  assertTestDatabase(process.env.DATABASE_URL);

  const dataSource = app.get(DataSource);
  await dataSource.synchronize(true);

  return dataSource;
}

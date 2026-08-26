import type { EnvService } from '../env/env.service';
import { databaseConfig } from './database.config';

const values: Record<string, unknown> = {
  NODE_ENV: 'dev',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/payments',
};

function makeEnv(overrides: Record<string, unknown> = {}): EnvService {
  const env = { ...values, ...overrides };

  return { get: vi.fn((key: string) => env[key]) } as unknown as EnvService;
}

describe('databaseConfig', () => {
  it('builds a postgres connection from the validated environment', () => {
    const config = databaseConfig(makeEnv());

    expect(config).toMatchObject({
      type: 'postgres',
      url: 'postgres://user:pass@localhost:5432/payments',
      autoLoadEntities: true,
    });
  });

  it('synchronizes the schema only in dev', () => {
    expect(databaseConfig(makeEnv({ NODE_ENV: 'dev' }))).toMatchObject({
      synchronize: true,
    });

    // A schema sync against test or production data would drop columns the
    // entities no longer declare.
    expect(databaseConfig(makeEnv({ NODE_ENV: 'test' }))).toMatchObject({
      synchronize: false,
    });
    expect(databaseConfig(makeEnv({ NODE_ENV: 'production' }))).toMatchObject({
      synchronize: false,
    });
  });

  it('silences query logging in production only', () => {
    expect(databaseConfig(makeEnv({ NODE_ENV: 'production' }))).toMatchObject({
      logging: false,
    });
    expect(databaseConfig(makeEnv({ NODE_ENV: 'dev' }))).toMatchObject({
      logging: true,
    });
    expect(databaseConfig(makeEnv({ NODE_ENV: 'test' }))).toMatchObject({
      logging: true,
    });
  });

  it('reads the connection from EnvService, never from process.env', () => {
    const env = makeEnv();

    databaseConfig(env);

    // Reading `process.env` directly would bypass the Zod schema that
    // validated and coerced these values at boot.
    expect(env.get).toHaveBeenCalledWith('DATABASE_URL');
  });
});

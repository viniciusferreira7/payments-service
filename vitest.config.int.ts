import { mergeConfig } from 'vitest/config';
import { baseConfig } from './vitest.shared';

// Integration tests: *.int-spec.ts. Wire multiple modules through the DI
// container (and real infra like Postgres/RabbitMQ as it lands), without going
// through the HTTP boundary. Run serially with generous timeouts; extend
// `setupFiles` with migrations/seed once a test-infra bootstrap exists.
export default mergeConfig(baseConfig, {
  test: {
    include: ['**/*.int-spec.ts'],
    setupFiles: ['./test/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 100_000,
    hookTimeout: 100_000,
  },
});

import { mergeConfig } from 'vitest/config';
import { baseConfig } from './vitest.shared.mts';

// Integration tests: *.int-spec.ts. Wire multiple modules through the DI
// container, standing in doubles for the infra the suite does not own, so a
// spec pins behaviour without waiting on a broker. The e2e lane is where real
// infra is driven end to end. Run serially with generous timeouts; extend
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

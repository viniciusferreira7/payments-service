import { baseConfig } from './vitest.shared';

// Unit tests: *.spec.ts (Vitest's default include). Pure and isolated — no
// NestApplication boot, no external infra. This is the default config, so
// `vitest run` / `pnpm test:unit` runs this lane.
export default baseConfig;

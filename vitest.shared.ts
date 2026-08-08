import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Base Vitest config shared by the unit, integration and e2e runners
 * (vitest.config.ts / vitest.config.int.ts / vitest.config.e2e.ts). Each
 * runner merges this and overrides only its include glob, parallelism and
 * timeouts.
 */
export const baseConfig = defineConfig({
  test: {
    globals: true,
    root: './',
  },
  resolve: {
    // Mirror tsconfig.json: the `@/*` -> `./src/*` alias and the `baseUrl`
    // that lets specs import `test/...` helpers.
    alias: {
      '@': resolve(__dirname, 'src'),
      test: resolve(__dirname, 'test'),
    },
  },
  // Disable Vite's default Oxc transform so swc fully owns transformation
  // (Oxc replaced esbuild as the default in Vite 8 / Vitest 4, so the
  // `esbuild: false` that unplugin-swc sets is now a no-op).
  oxc: false,
  plugins: [
    // Keeps emitDecoratorMetadata working for NestJS DI in tests.
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});

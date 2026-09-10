import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: process.env.FIRESTORE_EMULATOR_HOST ? [] : ['tests/firestore.rules.test.ts'],
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      '@robinhacks/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
      '@robinhacks/application': new URL('./packages/application/src/index.ts', import.meta.url)
        .pathname,
    },
  },
});

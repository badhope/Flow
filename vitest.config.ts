import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  test: {
    include: [
      'server/**/*.spec.ts',
      'shared/**/*.spec.ts',
      'client/**/*.spec.ts',
      'client/**/*.spec.tsx',
    ],
    environment: 'node',
    environmentMatchGlobs: [['client/**', 'jsdom']],
    setupFiles: ['client/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['server/**/*.ts'],
      exclude: [
        'server/**/*.spec.ts',
        'server/database/schema.ts',
        'server/main.ts',
        'server/**/*.module.ts',
        'server/**/*.controller.ts',
      ],
    },
  },
});

import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/security/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'tests/edge/**', 'node_modules/**', 'dist/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/lib/**/*.ts', 'src/services/**/*.ts'],
    },
  },
});

import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // package.json "imports" subpath map for cds-typer models
      {
        find: /^#cds-models\/(.*)$/,
        replacement: path.resolve(__dirname, '@cds-models') + '/$1/index.js'
      }
    ]
  },
  test: {
    globals: true,
    environment: 'node',
    // Fork per test file: process isolation for the global cds singleton,
    // and forks are killed after the run (no leaked handles from cds.test()).
    pool: 'forks',
    // Three suites each boot a full CAP server on an in-memory SQLite —
    // run one file at a time (was Jest's default worker pool, serial is safer).
    fileParallelism: false,
    setupFiles: ['test/vitest.setup.ts'],
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'], // CI uploads coverage/lcov.info to Codecov
      reportsDirectory: 'coverage',
      include: ['srv/**/*.ts'],
      exclude: ['srv/**/*.d.ts']
    }
  }
});

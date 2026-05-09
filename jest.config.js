/**
 * Jest config for FINCA.
 *
 * - ts-jest preset for TypeScript transformation.
 * - SKIP_AUTO_INIT prevents @odatano/core from connecting to backends during tests.
 * - testTimeout bumped because cds.test boots an in-memory SQLite per file.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  testTimeout: 30_000,
  setupFiles: ['<rootDir>/test/env.js'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  collectCoverageFrom: [
    'srv/**/*.ts',
    '!srv/**/*.d.ts'
  ],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      isolatedModules: true,
      diagnostics: false,
      tsconfig: {
        module: 'commonjs',
        moduleResolution: 'node',
        target: 'es2022',
        esModuleInterop: true,
        strict: false,
        skipLibCheck: true,
        allowJs: true
      }
    }]
  }
};

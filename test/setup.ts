/**
 * Per-test-file setup (runs after Jest globals are installed).
 * Maps mocha-style hooks used by cds.test() to their Jest equivalents.
 */
(global as any).before = beforeAll;
(global as any).after = afterAll;

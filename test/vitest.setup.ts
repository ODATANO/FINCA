/**
 * Vitest global setup (runs before every test file).
 *
 * Uses require() instead of imports: require is not hoisted, so the env vars
 * below are guaranteed to be set before any CDS module loads. @sap/cds is
 * externalized (node_modules CJS), so require() yields the same instance the
 * test files get via import.
 */

process.env.NODE_ENV = 'test';
process.env.SKIP_AUTO_INIT = 'true';
process.env.CDS_TYPESCRIPT = 'true'; // CAP must load srv/finance-service.ts — no compiled .js twins exist
process.env.NETWORK = 'preview';
process.env.BACKENDS = 'koios';
process.env.TX_BUILDERS = 'buildooor';

// CAP resolves srv/*.ts impls via native require at cds.test() boot; register
// the on-the-fly compile hook. transpileOnly ≙ old ts-jest isolatedModules +
// diagnostics:false — type errors must not throw inside cds.utils._import().
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs', moduleResolution: 'node', target: 'es2022',
    esModuleInterop: true, strict: false, skipLibCheck: true, allowJs: true
  }
});

const cds = require('@sap/cds');
cds.env.requires.db = { kind: 'sqlite', credentials: { url: ':memory:' } };
cds.env.requires.auth = { kind: 'custom', impl: './test/auth-stub' };

// cds^10: Queue-Scheduling ist per Default an und pollt die DB im Hintergrund.
// Beim In-Memory-SQLite ist jede weitere Pool-Connection eine *leere* DB →
// sporadische `no such table`-Fehler. Beides hart abschalten.
cds.env.requires.queue = false;
cds.env.requires.scheduling = false;

// cds.test() installs process.on('unhandledRejection') → server shutdown.
// Under Vitest the test client's *expected* 4xx rejections transiently trip
// that handler (they didn't under Jest), killing the server mid-suite — every
// later request then fails with ECONNREFUSED. Vitest reports real unhandled
// rejections itself, so nothing is lost by disabling the cds handler.
cds.env.server.shutdown_on_uncaught_errors = false;

// cds.test() registers mocha-style before/after hooks; map them onto Vitest's
// unless the installed @cap-js/cds-test already handles that itself.
(globalThis as any).before ??= beforeAll;
(globalThis as any).after ??= afterAll;

// SKIP_AUTO_INIT leaves ODATANO's network context null; network-dependent
// validators (e.g. the bech32 check in VerifyDataSignature) would otherwise
// reject every address with `400 Invalid bech32 address format`.
require('@odatano/core/srv/utils/network-context').setActiveNetwork('preview');

/**
 * Pre-globals env setup — runs before Jest installs its globals.
 * Only env vars and require-hooks belong here. Anything that uses
 * beforeAll/beforeEach must go in setup.ts (setupFilesAfterEach).
 */
process.env.SKIP_AUTO_INIT = 'true';
process.env.CDS_TYPESCRIPT = 'true';   // CAP must load srv/finance-service.ts (factory.js:46)
process.env.NETWORK = 'preview';
process.env.BACKENDS = 'koios';
process.env.TX_BUILDERS = 'buildooor';

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    moduleResolution: 'node',
    target: 'es2022',
    esModuleInterop: true,
    strict: false,
    skipLibCheck: true,
    allowJs: true
  }
});

const cds = require('@sap/cds');
cds.env.requires.db = { kind: 'sqlite', credentials: { url: ':memory:' } };
cds.env.requires.auth = { kind: 'custom', impl: './test/auth-stub' };

// cds^10: Queue-Scheduling ist per Default an und pollt die DB im Hintergrund.
// Beim In-Memory-SQLite bekommt jede weitere Pool-Connection eine LEERE DB —
// Tests laufen dann sporadisch auf "no such table". FINCA nutzt keine Event
// Queues, daher in Tests komplett aus.
cds.env.requires.queue = false;
cds.env.requires.scheduling = false;

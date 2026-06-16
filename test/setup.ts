/**
 * Per-test-file setup (runs after Jest globals are installed).
 * Maps mocha-style hooks used by cds.test() to their Jest equivalents.
 */
(global as any).before = beforeAll;
(global as any).after = afterAll;

// SKIP_AUTO_INIT=true means ODATANO's bootstrap never runs, so its network
// context stays null and network-aware validators (e.g. the bech32 check in
// CardanoSignService.VerifyDataSignature) reject everything. Set it explicitly
// to mirror a `network: 'preview'` bootstrap — matches NETWORK in test/env.js.
require('@odatano/core/srv/utils/network-context').setActiveNetwork('preview');

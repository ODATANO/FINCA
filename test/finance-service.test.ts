/**
 * Integration tests for FinanceService using cds.test (in-memory SQLite).
 *
 * The chain-adapter is mocked so no real ODATANO/Cardano backend is needed.
 */
import cds from '@sap/cds';

// Mock the chain-adapter on the NATIVE module graph: the CAP server booted by
// cds.test() loads srv/finance-service.ts through Node's require (ts-node), so
// vi.mock — which only patches the Vite module graph — would never reach it.
// require() shares the native graph, so these spies land on the exact module
// instance the service handlers call (NIGHTGATE pattern, see ODATANO tests).
const chain = require('../srv/lib/chain-adapter') as typeof import('../srv/lib/chain-adapter');

vi.spyOn(chain, 'buildMetadataTx').mockImplementation(async () => ({
  buildId: '11111111-1111-4111-8111-111111111111',
  unsignedCbor: 'aa00bb',
  txBodyHash: 'cc00dd',
  fee: '180000'
}));
vi.spyOn(chain, 'createSigningRequest').mockImplementation(async () => '22222222-2222-4222-8222-222222222222');
vi.spyOn(chain, 'submitSigned').mockImplementation(async () => ({
  txHash: 'tx-hash-deadbeef',
  status: 'SUBMITTED'
}));
vi.spyOn(chain, 'getTxStatus').mockImplementation(async () => ({ confirmed: true, slot: 12345, blockNumber: 678 }));
vi.spyOn(chain, 'getOnChainMetadata').mockImplementation(async () => [
  { label: '1447', payload: '{"org":{"id":"x"}}' }
]);

// NB: do NOT destructure `expect` from cds.test() — accessing that getter
// installs chai(+chai-as-promised) as the GLOBAL expect and clobbers Vitest's,
// silently breaking `.rejects` matchers in the whole file.
const { GET, POST } = (cds as any).test(__dirname + '/..');

describe('FinanceService — integration', () => {
  // Distinct UUIDs to avoid collisions with CSV seed data auto-loaded by cds.test
  const ORG_ID  = '00000000-0000-4000-8000-test00000001';
  const TX_OK   = '00000000-0000-4000-8000-test0000ok01';
  const TX_BAD  = '00000000-0000-4000-8000-test0000bad1';

  beforeAll(async () => {
    const { Organisations, Transactions, TransactionItems } = cds.entities('finca');

    // Wipe any previously-seeded rows (keeps the test self-contained)
    await DELETE.from(TransactionItems);
    await DELETE.from(Transactions);
    await DELETE.from(Organisations);

    await INSERT.into(Organisations).entries({
      ID: ORG_ID,
      name: 'Test Org', currencyCode: 'EUR', countryCode: 'DE',
      taxIdNumber: 'DE000', walletAddress: 'addr_test1xxx'
    });
    await INSERT.into(Transactions).entries([
      {
        ID: TX_OK, org_ID: ORG_ID, batchId: 'B-OK',
        transactionNumber: 'T1', type: 'JOURNAL', date: '2025-01-15', status: 'DRAFT'
      },
      {
        ID: TX_BAD, org_ID: ORG_ID, batchId: 'B-BAD',
        transactionNumber: 'T2', type: 'JOURNAL', date: '2025-01-15', status: 'DRAFT'
      }
    ]);
    await INSERT.into(TransactionItems).entries([
      { ID: '00000000-0000-4000-8000-item00000001', transaction_ID: TX_OK,  lineNumber: 1, accountCode: '6300', amount: '1000.00' },
      { ID: '00000000-0000-4000-8000-item00000002', transaction_ID: TX_OK,  lineNumber: 2, accountCode: '1200', amount: '-1000.00' },
      { ID: '00000000-0000-4000-8000-item00000003', transaction_ID: TX_BAD, lineNumber: 1, accountCode: '6300', amount: '1000.00' },
      { ID: '00000000-0000-4000-8000-item00000004', transaction_ID: TX_BAD, lineNumber: 2, accountCode: '1200', amount: '-999.50' }
    ]);
  });

  describe('ValidateBatch', () => {
    test('passes for balanced double-entry', async () => {
      const res = await POST('/odata/v4/finance/ValidateBatch', { batchId: 'B-OK' });
      expect(res.data.valid).toBe(true);
      expect(res.data.errors).toEqual([]);
    });

    test('fails with exact decimal diff for unbalanced batch', async () => {
      const res = await POST('/odata/v4/finance/ValidateBatch', { batchId: 'B-BAD' });
      expect(res.data.valid).toBe(false);
      expect(res.data.errors[0]).toMatch(/0\.50/);  // exact, not 0.5000000000000001
    });

    test('404 for unknown batch', async () => {
      await expect(POST('/odata/v4/finance/ValidateBatch', { batchId: 'NOPE' }))
        .rejects.toMatchObject({ response: { status: 404 } });
    });
  });

  describe('PublishTransactions', () => {
    test('returns valid UUID anchorId (not buildId fallback)', async () => {
      const res = await POST('/odata/v4/finance/PublishTransactions', {
        batchId: 'B-OK'
      });
      expect(res.data.anchorId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(res.data.buildId).toBe('11111111-1111-4111-8111-111111111111');
      expect(res.data.unsignedCbor).toBe('aa00bb');
    });

    test('persists OnChainAnchor with the returned anchorId', async () => {
      const res = await POST('/odata/v4/finance/PublishTransactions', {
        batchId: 'B-OK'
      });
      const { OnChainAnchors } = cds.entities('finca');
      const anchor = await SELECT.one.from(OnChainAnchors).where({ ID: res.data.anchorId });
      expect(anchor).toBeTruthy();
      expect(anchor.status).toBe('PENDING');
      expect(anchor.metadataLabel).toBe(1447);
    });
  });

  describe('VerifyTransaction', () => {
    test('returns onChain payload for known txHash', async () => {
      const res = await GET("/odata/v4/finance/VerifyTransaction(txHash='tx-hash-deadbeef')");
      expect(res.data.verified).toBe(true);
      expect(res.data.onChainData).toContain('"id":"x"');
    });
  });

  describe('CheckPendingAnchors', () => {
    const ANCHOR_ID = '00000000-0000-4000-8000-anchor000poll';

    beforeAll(async () => {
      const { OnChainAnchors } = cds.entities('finca');
      // Clear any anchors created by PublishTransactions tests so only ours matches
      await DELETE.from(OnChainAnchors);
      await INSERT.into(OnChainAnchors).entries({
        ID: ANCHOR_ID,
        transaction_ID: TX_OK,
        txHash: 'tx-hash-pending-confirm',
        status: 'SUBMITTED',
        metadataLabel: 1447,
        submittedAt: new Date().toISOString()
      });
    });

    test('confirms SUBMITTED anchors and flips the linked transaction to CONFIRMED', async () => {
      const res = await POST('/odata/v4/finance/CheckPendingAnchors', {});
      expect(res.data.updated).toBe(1);

      const { OnChainAnchors, Transactions } = cds.entities('finca');
      const anchor = await SELECT.one.from(OnChainAnchors).where({ ID: ANCHOR_ID });
      expect(anchor.status).toBe('CONFIRMED');
      // ieee754compatible betrifft nur OData-Responses; ein direkter DB-Read
      // liefert Int64 im safe range als number
      expect(Number(anchor.slot)).toBe(12345);
      expect(Number(anchor.blockNumber)).toBe(678);
      expect(anchor.confirmedAt).toBeTruthy();

      const tx = await SELECT.one.from(Transactions).where({ ID: TX_OK });
      expect(tx.status).toBe('CONFIRMED');
    });
  });

  describe('ProvisionOrg', () => {
    const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    beforeAll(async () => {
      // Clean slate so the wallet has no org yet — required for the create path
      const { OnChainAnchors, TransactionItems, Transactions, Organisations } = cds.entities('finca');
      await DELETE.from(OnChainAnchors);
      await DELETE.from(TransactionItems);
      await DELETE.from(Transactions);
      await DELETE.from(Organisations);
    });

    test('creates a new org with EUR/DE defaults and a Wallet-suffix name', async () => {
      const res = await POST('/odata/v4/finance/ProvisionOrg', {});
      expect(res.data.created).toBe(true);
      expect(res.data.ID).toMatch(UUID_V4);
      expect(res.data.walletAddress).toBe('addr_test1xxx');
      expect(res.data.name).toMatch(/^Wallet /);

      const { Organisations } = cds.entities('finca');
      const persisted = await SELECT.one.from(Organisations).where({ ID: res.data.ID });
      expect(persisted.currencyCode).toBe('EUR');
      expect(persisted.countryCode).toBe('DE');
    });

    test('returns existing org with created=false on second call (idempotent)', async () => {
      const res = await POST('/odata/v4/finance/ProvisionOrg', { name: 'Should be ignored' });
      expect(res.data.created).toBe(false);
      expect(res.data.walletAddress).toBe('addr_test1xxx');
      // name from the first call wins, not the one passed here
      expect(res.data.name).toMatch(/^Wallet /);
    });

    test('honors custom name, currency, country when creating fresh', async () => {
      const { Organisations } = cds.entities('finca');
      await DELETE.from(Organisations);

      const res = await POST('/odata/v4/finance/ProvisionOrg', {
        name: 'My Org Inc.',
        currencyCode: 'USD',
        countryCode: 'US'
      });
      expect(res.data.created).toBe(true);
      expect(res.data.name).toBe('My Org Inc.');

      const persisted = await SELECT.one.from(Organisations).where({ ID: res.data.ID });
      expect(persisted.currencyCode).toBe('USD');
      expect(persisted.countryCode).toBe('US');
    });
  });
});

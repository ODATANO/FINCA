/**
 * Integration tests for FinanceService using cds.test (in-memory SQLite).
 *
 * The chain-adapter is mocked so no real ODATANO/Cardano backend is needed.
 */
import cds from '@sap/cds';

// Mock chain-adapter before service loads
jest.mock('../srv/lib/chain-adapter', () => ({
  buildMetadataTx: jest.fn(async () => ({
    buildId: '11111111-1111-4111-8111-111111111111',
    unsignedCbor: 'aa00bb',
    txBodyHash: 'cc00dd',
    fee: '180000'
  })),
  submitSigned: jest.fn(async () => ({
    txHash: 'tx-hash-deadbeef',
    status: 'SUBMITTED'
  })),
  getTxStatus: jest.fn(async () => ({ confirmed: true, slot: 12345, blockNumber: 678 })),
  getOnChainMetadata: jest.fn(async () => [
    { label: '1447', payload: '{"org":{"id":"x"}}' }
  ])
}));

const { GET, POST, expect: cdsExpect } = (cds as any).test(__dirname + '/..');

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
        batchId: 'B-OK', walletAddress: 'addr_test1xxx'
      });
      expect(res.data.anchorId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(res.data.buildId).toBe('11111111-1111-4111-8111-111111111111');
      expect(res.data.unsignedCbor).toBe('aa00bb');
    });

    test('persists OnChainAnchor with the returned anchorId', async () => {
      const res = await POST('/odata/v4/finance/PublishTransactions', {
        batchId: 'B-OK', walletAddress: 'addr_test1xxx'
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
});

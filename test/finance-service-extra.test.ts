/**
 * Coverage-extension tests for FinanceService — exercises the error/edge
 * branches that the main finance-service.test.ts happy-path doesn't reach:
 * PublishReport, SubmitSigned, RetryFailed, VerifyReport, additional
 * ValidateBatch error paths, and VerifyTransaction's no-anchor / non-owned
 * branches.
 *
 * Uses its own in-memory DB (one Vitest fork per test file) and a distinct
 * UUID namespace so it cannot collide with the main suite.
 */
import cds from '@sap/cds';

// Spies on the NATIVE module graph — the CAP-loaded service requires the same
// instance, so the stubs actually reach the handlers (see finance-service.test.ts).
const chain = require('../srv/lib/chain-adapter') as typeof import('../srv/lib/chain-adapter');

const chainMock = {
  buildMetadataTx: vi.spyOn(chain, 'buildMetadataTx').mockImplementation(async () => ({
    buildId: '33333333-3333-4333-8333-333333333333',
    unsignedCbor: 'aabb',
    txBodyHash: 'ccdd',
    fee: '180000'
  })),
  createSigningRequest: vi.spyOn(chain, 'createSigningRequest').mockImplementation(async () => '44444444-4444-4444-8444-444444444444'),
  submitSigned: vi.spyOn(chain, 'submitSigned').mockImplementation(async () => ({
    txHash: 'tx-hash-extra-ok',
    status: 'SUBMITTED'
  })),
  getTxStatus: vi.spyOn(chain, 'getTxStatus').mockImplementation(async () => ({ confirmed: true, slot: 7777, blockNumber: 8888 })),
  getOnChainMetadata: vi.spyOn(chain, 'getOnChainMetadata').mockImplementation(async () => [
    { label: '1447', payload: '{"org":{"id":"extra"}}' }
  ])
};

const { GET, POST } = (cds as any).test(__dirname + '/..');

describe('FinanceService — extra coverage', () => {
  // Distinct namespace so this file's data can't collide with finance-service.test.ts
  const ORG_OWN     = '00000000-0000-4000-8000-extra0000001';   // walletAddress=addr_test1xxx
  const ORG_OTHER   = '00000000-0000-4000-8000-extra0000002';   // walletAddress=other
  const TX_DRAFT    = '00000000-0000-4000-8000-extratx00001';
  const TX_DONE     = '00000000-0000-4000-8000-extratx00002';   // PUBLISHED → not publishable
  const TX_NO_DATE  = '00000000-0000-4000-8000-extratx00003';
  const TX_NO_ITEMS = '00000000-0000-4000-8000-extratx00004';
  const TX_NO_ACCT  = '00000000-0000-4000-8000-extratx00005';
  const TX_OTHER    = '00000000-0000-4000-8000-extratx00006';   // owned by ORG_OTHER
  const REPORT_OK   = '00000000-0000-4000-8000-rpt000000001';   // DRAFT
  const REPORT_DONE = '00000000-0000-4000-8000-rpt000000002';   // PUBLISHED
  const ANCHOR_PEND = '00000000-0000-4000-8000-anchorpend01';
  const ANCHOR_FAIL = '00000000-0000-4000-8000-anchorfail01';   // FAILED, linked to TX_DRAFT
  const ANCHOR_RPT  = '00000000-0000-4000-8000-anchorfail02';   // FAILED, linked to REPORT_OK
  const ANCHOR_OTHR = '00000000-0000-4000-8000-anchorothr01';   // CONFIRMED, linked to TX_OTHER
  const ANCHOR_RVRF = '00000000-0000-4000-8000-anchorrvrf01';   // CONFIRMED, linked to REPORT_OK
  const TEST_WALLET = 'addr_test1xxx';

  beforeAll(async () => {
    const {
      Organisations, Transactions, TransactionItems,
      FinancialReports, ReportEntries, OnChainAnchors
    } = cds.entities('finca');

    await DELETE.from(OnChainAnchors);
    await DELETE.from(ReportEntries);
    await DELETE.from(FinancialReports);
    await DELETE.from(TransactionItems);
    await DELETE.from(Transactions);
    await DELETE.from(Organisations);

    await INSERT.into(Organisations).entries([
      { ID: ORG_OWN,   name: 'Extra Org', currencyCode: 'EUR', countryCode: 'DE', walletAddress: TEST_WALLET },
      { ID: ORG_OTHER, name: 'Foreign Org', currencyCode: 'EUR', countryCode: 'DE', walletAddress: 'addr_test1foreign' }
    ]);

    await INSERT.into(Transactions).entries([
      { ID: TX_DRAFT,    org_ID: ORG_OWN,   batchId: 'B-EXTRA-OK',  transactionNumber: 'EX-1', type: 'JOURNAL', date: '2025-02-01', status: 'DRAFT' },
      { ID: TX_DONE,     org_ID: ORG_OWN,   batchId: 'B-EXTRA-DONE', transactionNumber: 'EX-2', type: 'JOURNAL', date: '2025-02-01', status: 'PUBLISHED' },
      { ID: TX_NO_DATE,  org_ID: ORG_OWN,   batchId: 'B-NO-DATE',   transactionNumber: 'EX-3', type: 'JOURNAL', date: null,         status: 'DRAFT' },
      { ID: TX_NO_ITEMS, org_ID: ORG_OWN,   batchId: 'B-NO-ITEMS',  transactionNumber: 'EX-4', type: 'JOURNAL', date: '2025-02-01', status: 'DRAFT' },
      { ID: TX_NO_ACCT,  org_ID: ORG_OWN,   batchId: 'B-NO-ACCT',   transactionNumber: 'EX-5', type: 'JOURNAL', date: '2025-02-01', status: 'DRAFT' },
      { ID: TX_OTHER,    org_ID: ORG_OTHER, batchId: 'B-OTHER',     transactionNumber: 'EX-6', type: 'JOURNAL', date: '2025-02-01', status: 'DRAFT' }
    ]);

    await INSERT.into(TransactionItems).entries([
      // TX_DRAFT — balanced
      { ID: '00000000-0000-4000-8000-extraitem001', transaction_ID: TX_DRAFT, lineNumber: 1, accountCode: '6300', amount: '500.00' },
      { ID: '00000000-0000-4000-8000-extraitem002', transaction_ID: TX_DRAFT, lineNumber: 2, accountCode: '1200', amount: '-500.00' },
      // TX_DONE — balanced (for ownership lookups)
      { ID: '00000000-0000-4000-8000-extraitem003', transaction_ID: TX_DONE,  lineNumber: 1, accountCode: '6300', amount: '100.00' },
      { ID: '00000000-0000-4000-8000-extraitem004', transaction_ID: TX_DONE,  lineNumber: 2, accountCode: '1200', amount: '-100.00' },
      // TX_NO_DATE — balanced; date is the issue
      { ID: '00000000-0000-4000-8000-extraitem005', transaction_ID: TX_NO_DATE, lineNumber: 1, accountCode: '6300', amount: '50.00' },
      { ID: '00000000-0000-4000-8000-extraitem006', transaction_ID: TX_NO_DATE, lineNumber: 2, accountCode: '1200', amount: '-50.00' },
      // TX_NO_ITEMS — no items at all
      // TX_NO_ACCT — one item without accountCode
      { ID: '00000000-0000-4000-8000-extraitem007', transaction_ID: TX_NO_ACCT, lineNumber: 1, accountCode: null,  amount: '0.00' }
    ]);

    await INSERT.into(FinancialReports).entries([
      { ID: REPORT_OK,   org_ID: ORG_OWN, subType: 'BALANCE_SHEET',    year: 2025, status: 'DRAFT' },
      { ID: REPORT_DONE, org_ID: ORG_OWN, subType: 'INCOME_STATEMENT', year: 2025, status: 'PUBLISHED' }
    ]);

    await INSERT.into(ReportEntries).entries([
      { ID: '00000000-0000-4000-8000-rptentry00001', report_ID: REPORT_OK, category: 'ASSETS', subCategory: 'CURRENT', lineItem: 'Cash', amount: '1000.00', sortOrder: 1 }
    ]);

    await INSERT.into(OnChainAnchors).entries([
      { ID: ANCHOR_PEND, transaction_ID: TX_DRAFT, buildId: 'build-pending-1', signingRequestId: 'sr-1',
        unsignedCbor: 'aa', status: 'PENDING', metadataLabel: 1447 },
      { ID: ANCHOR_FAIL, transaction_ID: TX_DRAFT, buildId: 'build-failed-1',  signingRequestId: 'sr-2',
        unsignedCbor: 'aa', status: 'FAILED', metadataLabel: 1447, errorMessage: 'old error' },
      { ID: ANCHOR_RPT,  report_ID: REPORT_OK,    buildId: 'build-failed-rpt', signingRequestId: 'sr-3',
        unsignedCbor: 'aa', status: 'FAILED', metadataLabel: 1447 },
      { ID: ANCHOR_OTHR, transaction_ID: TX_OTHER, buildId: 'build-other-1',   signingRequestId: 'sr-4',
        txHash: 'tx-hash-other-owner', status: 'CONFIRMED', metadataLabel: 1447 },
      { ID: ANCHOR_RVRF, report_ID: REPORT_OK,     buildId: 'build-rvrf',      signingRequestId: 'sr-5',
        txHash: 'tx-hash-report-confirmed', status: 'CONFIRMED', metadataLabel: 1447 }
    ]);
  });

  // ─── ValidateBatch error branches ─────────────────────────────────────────

  describe('ValidateBatch — error branches', () => {
    test('reports missing date', async () => {
      const res = await POST('/odata/v4/finance/ValidateBatch', { batchId: 'B-NO-DATE' });
      expect(res.data.valid).toBe(false);
      expect(res.data.errors.join('|')).toMatch(/Missing date/);
    });

    test('reports missing items', async () => {
      const res = await POST('/odata/v4/finance/ValidateBatch', { batchId: 'B-NO-ITEMS' });
      expect(res.data.valid).toBe(false);
      expect(res.data.errors.join('|')).toMatch(/No line items/);
    });

    test('reports missing accountCode', async () => {
      const res = await POST('/odata/v4/finance/ValidateBatch', { batchId: 'B-NO-ACCT' });
      expect(res.data.valid).toBe(false);
      expect(res.data.errors.join('|')).toMatch(/Missing account code/);
    });
  });

  // ─── PublishTransactions — non-publishable status ─────────────────────────

  describe('PublishTransactions — status guards', () => {
    test('rejects when any TX is already PUBLISHED', async () => {
      await expect(POST('/odata/v4/finance/PublishTransactions', { batchId: 'B-EXTRA-DONE' }))
        .rejects.toMatchObject({ response: { status: 400 } });
    });
  });

  // ─── PublishReport ────────────────────────────────────────────────────────

  describe('PublishReport', () => {
    test('404 for unknown report', async () => {
      await expect(POST('/odata/v4/finance/PublishReport', { reportId: 'does-not-exist' }))
        .rejects.toMatchObject({ response: { status: 404 } });
    });

    test('rejects already-PUBLISHED report', async () => {
      await expect(POST('/odata/v4/finance/PublishReport', { reportId: REPORT_DONE }))
        .rejects.toMatchObject({ response: { status: 400 } });
    });

    test('happy path → returns anchorId + persists anchor with report_ID', async () => {
      const res = await POST('/odata/v4/finance/PublishReport', { reportId: REPORT_OK });
      expect(res.data.anchorId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(res.data.buildId).toBe('33333333-3333-4333-8333-333333333333');

      const { OnChainAnchors } = cds.entities('finca');
      const anchor = await SELECT.one.from(OnChainAnchors).where({ ID: res.data.anchorId });
      expect(anchor).toBeTruthy();
      expect(anchor.report_ID).toBe(REPORT_OK);
      expect(anchor.status).toBe('PENDING');
    });
  });

  // ─── SubmitSigned ─────────────────────────────────────────────────────────

  describe('SubmitSigned', () => {
    test('404 for unknown buildId', async () => {
      await expect(POST('/odata/v4/finance/SubmitSigned', { buildId: 'no-such', signedTxCbor: 'aa' }))
        .rejects.toMatchObject({ response: { status: 404 } });
    });

    test('rejects non-PENDING anchor', async () => {
      await expect(POST('/odata/v4/finance/SubmitSigned', {
        buildId: 'build-failed-1',         // anchor.status === FAILED
        signedTxCbor: 'ee'
      })).rejects.toMatchObject({ response: { status: 400 } });
    });

    test('happy path → anchor SUBMITTED, linked TX → PUBLISHED', async () => {
      const res = await POST('/odata/v4/finance/SubmitSigned', {
        buildId: 'build-pending-1',
        signedTxCbor: 'eeff'
      });
      expect(res.data.txHash).toBe('tx-hash-extra-ok');
      expect(res.data.status).toBe('SUBMITTED');

      const { OnChainAnchors, Transactions } = cds.entities('finca');
      const anchor = await SELECT.one.from(OnChainAnchors).where({ ID: ANCHOR_PEND });
      expect(anchor.status).toBe('SUBMITTED');
      expect(anchor.txHash).toBe('tx-hash-extra-ok');
      expect(anchor.signedCbor).toBe('eeff');

      const tx = await SELECT.one.from(Transactions).where({ ID: TX_DRAFT });
      expect(tx.status).toBe('PUBLISHED');
    });

    test('does not deadlock when the submit opens its own root tx (ODATANO KNOWN_ISSUES #11)', async () => {
      const { OnChainAnchors } = cds.entities('finca');
      const ANCHOR_PEND2 = '00000000-0000-4000-8000-anchorpend02';
      await INSERT.into(OnChainAnchors).entries({
        ID: ANCHOR_PEND2, transaction_ID: TX_DRAFT, buildId: 'build-pending-2',
        signingRequestId: 'sr-6', unsignedCbor: 'aa', status: 'PENDING', metadataLabel: 1447
      });

      // Mirror the real plugin: SubmitVerifiedTransaction runs its bookkeeping
      // in a NEW ROOT transaction (cds.tx). With sqlite's single pooled
      // connection this hangs forever if the handler still holds its request
      // transaction across the call.
      chainMock.submitSigned.mockImplementationOnce(async () => {
        await cds.tx(async () => {
          await SELECT.one.from(OnChainAnchors).where({ buildId: 'build-pending-2' });
        });
        return { txHash: 'tx-hash-detached-ok', status: 'SUBMITTED' };
      });

      const res = await POST('/odata/v4/finance/SubmitSigned', {
        buildId: 'build-pending-2',
        signedTxCbor: 'ff00'
      });
      expect(res.data.txHash).toBe('tx-hash-detached-ok');

      const anchor = await SELECT.one.from(OnChainAnchors).where({ ID: ANCHOR_PEND2 });
      expect(anchor.status).toBe('SUBMITTED');
    }, 15_000);
  });

  // ─── RetryFailed ──────────────────────────────────────────────────────────

  describe('RetryFailed', () => {
    test('404 for unknown anchorId', async () => {
      await expect(POST('/odata/v4/finance/RetryFailed', { anchorId: 'no-such-anchor' }))
        .rejects.toMatchObject({ response: { status: 404 } });
    });

    test('rejects non-FAILED anchor', async () => {
      await expect(POST('/odata/v4/finance/RetryFailed', { anchorId: ANCHOR_PEND }))
        .rejects.toMatchObject({ response: { status: 400 } });
    });

    test('rebuilds report-linked anchor and clears errorMessage', async () => {
      const res = await POST('/odata/v4/finance/RetryFailed', { anchorId: ANCHOR_RPT });
      expect(res.data.buildId).toBe('33333333-3333-4333-8333-333333333333');
      expect(res.data.unsignedCbor).toBe('aabb');

      const { OnChainAnchors } = cds.entities('finca');
      const anchor = await SELECT.one.from(OnChainAnchors).where({ ID: ANCHOR_RPT });
      expect(anchor.status).toBe('PENDING');
      expect(anchor.errorMessage).toBeNull();
      expect(anchor.buildId).toBe('33333333-3333-4333-8333-333333333333');
    });

    test('rebuilds transaction-linked anchor', async () => {
      const res = await POST('/odata/v4/finance/RetryFailed', { anchorId: ANCHOR_FAIL });
      expect(res.data.unsignedCbor).toBe('aabb');

      const { OnChainAnchors } = cds.entities('finca');
      const anchor = await SELECT.one.from(OnChainAnchors).where({ ID: ANCHOR_FAIL });
      expect(anchor.status).toBe('PENDING');
    });
  });

  // ─── VerifyTransaction — error branches ───────────────────────────────────

  describe('VerifyTransaction — edge cases', () => {
    test('verified=false when on-chain metadata lacks label 1447', async () => {
      chainMock.getOnChainMetadata.mockResolvedValueOnce([{ label: '674', payload: 'note' }]);
      const res = await GET("/odata/v4/finance/VerifyTransaction(txHash='tx-no-label')");
      expect(res.data.verified).toBe(false);
      expect(res.data.localMatch).toBe(false);
    });

    test('localMatch=false when no local anchor exists for the tx-hash', async () => {
      const res = await GET("/odata/v4/finance/VerifyTransaction(txHash='tx-hash-not-tracked-locally')");
      expect(res.data.verified).toBe(true);
      expect(res.data.localMatch).toBe(false);
    });

    test('403 when local anchor exists but caller does not own it', async () => {
      // req.reject in CAP sets the rejection on req — the try/catch around
      // _requireAnchorOwnership in the handler cannot swallow it, so the 403
      // propagates to the HTTP response. Pin that behavior.
      await expect(GET("/odata/v4/finance/VerifyTransaction(txHash='tx-hash-other-owner')"))
        .rejects.toMatchObject({ response: { status: 403 } });
    });
  });

  // ─── VerifyReport ─────────────────────────────────────────────────────────

  describe('VerifyReport', () => {
    test('404 for unknown report', async () => {
      await expect(GET("/odata/v4/finance/VerifyReport(reportId='no-such-report')"))
        .rejects.toMatchObject({ response: { status: 404 } });
    });

    test('verified=true with 1447 payload when confirmed anchor exists', async () => {
      // Ensure the default 1447 mock is used (not the one-shot override above)
      chainMock.getOnChainMetadata.mockResolvedValueOnce([
        { label: '1447', payload: '{"report":"ok"}' }
      ]);
      const res = await GET(`/odata/v4/finance/VerifyReport(reportId='${REPORT_OK}')`);
      expect(res.data.verified).toBe(true);
      expect(res.data.onChainData).toContain('"report":"ok"');
      expect(res.data.localMatch).toBe(true);
    });

    test('verified=false when no confirmed anchor for the report', async () => {
      // REPORT_DONE has no CONFIRMED anchor in our fixtures
      const res = await GET(`/odata/v4/finance/VerifyReport(reportId='${REPORT_DONE}')`);
      expect(res.data.verified).toBe(false);
      expect(res.data.onChainData).toBe('');
      expect(res.data.localMatch).toBe(false);
    });
  });
});

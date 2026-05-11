/**
 * FINCA Finance Service — Handler Implementation
 *
 * Manages financial data CRUD, on-chain publishing via ODATANO,
 * and blockchain verification.
 */
import cds, { ApplicationService, Request } from '@sap/cds';
import { randomUUID } from 'node:crypto';
import {
  buildTransactionMetadata,
  buildReportMetadata,
  estimateMetadataSize,
  MAX_METADATA_BYTES
} from './lib/metadata-builder';
import * as chain from './lib/chain-adapter';
import { sumDecimalsExact } from './lib/decimal';
import {
  Organisations,
  Transactions,
  FinancialReports,
  OnChainAnchors
} from '#cds-models/finca';

const LOG = cds.log('finance-service');

/**
 * Ensures the caller's wallet owns the given org. Returns the org row when
 * authorized, rejects the request with 403 otherwise.
 */
async function _requireOrg(req: Request, orgId: string | null | undefined) {
  const userId = req.user?.id;
  if (!userId || userId === 'anonymous') {
    return req.reject(401, 'Sign in required');
  }
  if (!orgId) return req.reject(404, 'Organisation not linked');
  const org = await SELECT.one.from(Organisations).where({ ID: orgId });
  if (!org) return req.reject(404, 'Organisation not found');
  if (org.walletAddress !== userId) {
    return req.reject(403, 'Resource does not belong to your wallet');
  }
  return org;
}

/**
 * Resolves an anchor's owning org via its linked transaction or report,
 * then enforces the connected wallet matches.
 */
async function _requireAnchorOwnership(req: Request, anchor: any) {
  let orgId: string | null | undefined;
  if (anchor.transaction_ID) {
    const tx = await SELECT.one.from(Transactions).where({ ID: anchor.transaction_ID });
    orgId = tx?.org_ID;
  } else if (anchor.report_ID) {
    const report = await SELECT.one.from(FinancialReports).where({ ID: anchor.report_ID });
    orgId = report?.org_ID;
  }
  return _requireOrg(req, orgId);
}

class FinanceService extends ApplicationService {
  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  async init() {
    // ─── Action Handlers ─────────────────────────────────────────────────

    this.on('ProvisionOrg', this._handleProvisionOrg.bind(this));
    this.on('PublishTransactions', this._handlePublishTransactions.bind(this));
    this.on('PublishReport', this._handlePublishReport.bind(this));
    this.on('SubmitSigned', this._handleSubmitSigned.bind(this));
    this.on('CheckPendingAnchors', this._handleCheckPendingAnchors.bind(this));
    this.on('RetryFailed', this._handleRetryFailed.bind(this));
    this.on('ValidateBatch', this._handleValidateBatch.bind(this));
    this.on('VerifyTransaction', this._handleVerifyTransaction.bind(this));
    this.on('VerifyReport', this._handleVerifyReport.bind(this));

    // Start polling for pending anchors (30s interval)
    this._startPolling();

    // Clear interval on shutdown to avoid leaks in tests / re-init
    cds.on('shutdown', () => this._stopPolling());

    await super.init();
  }

  // ─── ProvisionOrg (Onboarding) ──────────────────────────────────────────

  private async _handleProvisionOrg(req: Request) {
    const userId = req.user?.id;
    if (!userId || userId === 'anonymous') {
      return req.reject(401, 'Sign in required');
    }

    // Already provisioned?
    const existing = await SELECT.one.from(Organisations).where({ walletAddress: userId });
    if (existing) {
      return {
        ID: existing.ID,
        name: existing.name ?? '',
        walletAddress: existing.walletAddress ?? '',
        created: false
      };
    }

    const { name, currencyCode, countryCode } = req.data;
    const orgId = randomUUID();
    const orgName = (name && name.trim()) || `Wallet ${userId.slice(-8)}`;
    await INSERT.into(Organisations).entries({
      ID: orgId,
      name: orgName,
      currencyCode: currencyCode || 'EUR',
      countryCode: countryCode || 'DE',
      walletAddress: userId
    });

    LOG.info(`Provisioned new org '${orgId}' for wallet ${userId}`);
    return {
      ID: orgId,
      name: orgName,
      walletAddress: userId,
      created: true
    };
  }

  // ─── PublishTransactions ─────────────────────────────────────────────────

  private async _handlePublishTransactions(req: Request) {
    const { batchId } = req.data;

    // 1. Load transactions with items
    const txs = await SELECT.from(Transactions)
      .where({ batchId })
      .columns(col => {
        col('*');
        col.items(item => item('*'));
      });

    if (!txs || txs.length === 0) {
      return req.reject(404, `No transactions found for batch '${batchId}'`);
    }

    // Check all are in DRAFT or VALIDATED status
    const invalidTxs = txs.filter((tx: any) => !['DRAFT', 'VALIDATED'].includes(tx.status));
    if (invalidTxs.length > 0) {
      return req.reject(400, `${invalidTxs.length} transaction(s) not in publishable status`);
    }

    // 2. Ownership check + load org
    const org = await _requireOrg(req, txs[0].org_ID);
    const senderAddress = org.walletAddress as string;

    // 3. Build 1447 metadata
    const metadata = buildTransactionMetadata(txs, org);

    // Check size limit
    const size = estimateMetadataSize(metadata);
    if (size > MAX_METADATA_BYTES) {
      return req.reject(400, `Metadata too large (${size} bytes). Max: ${MAX_METADATA_BYTES}. Split into smaller batches.`);
    }

    // 4. Build unsigned TX via ODATANO (using connected wallet address)
    const buildResult = await chain.buildMetadataTx(metadata, senderAddress);

    // 5. Create signing request — required for CIP-30 witness-set submit
    const signingRequestId = await chain.createSigningRequest(
      buildResult.buildId,
      `FINCA batch ${batchId}`
    );

    // 6. Create OnChainAnchor record (UUID generated up-front for consistent return value)
    const anchorId = randomUUID();
    const anchor = {
      ID: anchorId,
      transaction_ID: txs[0].ID,  // Link to first TX in batch
      buildId: buildResult.buildId,
      signingRequestId,
      unsignedCbor: buildResult.unsignedCbor,
      txBodyHash: buildResult.txBodyHash,
      status: 'PENDING',
      metadataLabel: 1447
    };

    await INSERT.into(OnChainAnchors).entries(anchor);

    LOG.info(`Published batch '${batchId}': ${txs.length} transactions, build ${buildResult.buildId}`);

    return {
      buildId: buildResult.buildId,
      unsignedCbor: buildResult.unsignedCbor,
      txBodyHash: buildResult.txBodyHash,
      anchorId
    };
  }

  // ─── PublishReport ───────────────────────────────────────────────────────

  private async _handlePublishReport(req: Request) {
    const { reportId } = req.data;

    // 1. Load report with entries
    const report = await SELECT.one.from(FinancialReports)
      .where({ ID: reportId })
      .columns(col => {
        col('*');
        col.entries(entry => entry('*'));
      });

    if (!report) {
      return req.reject(404, 'Report not found');
    }
    if (!report.status || !['DRAFT', 'APPROVED'].includes(report.status)) {
      return req.reject(400, `Report status '${report.status}' is not publishable`);
    }

    // 2. Ownership check + load org
    const org = await _requireOrg(req, report.org_ID);
    const senderAddress = org.walletAddress as string;

    // 3. Build 1447 metadata
    const metadata = buildReportMetadata(report, report.entries || [], org);
    const size = estimateMetadataSize(metadata);
    if (size > MAX_METADATA_BYTES) {
      return req.reject(400, `Report metadata too large (${size} bytes). Max: ${MAX_METADATA_BYTES}.`);
    }

    // 4. Build unsigned TX (using connected wallet address)
    const buildResult = await chain.buildMetadataTx(metadata, senderAddress);

    // 5. Create signing request — required for CIP-30 witness-set submit
    const signingRequestId = await chain.createSigningRequest(
      buildResult.buildId,
      `FINCA report ${reportId}`
    );

    // 6. Create anchor (UUID generated up-front for consistent return value)
    const anchorId = randomUUID();
    const anchor = {
      ID: anchorId,
      report_ID: reportId,
      buildId: buildResult.buildId,
      signingRequestId,
      unsignedCbor: buildResult.unsignedCbor,
      txBodyHash: buildResult.txBodyHash,
      status: 'PENDING',
      metadataLabel: 1447
    };
    await INSERT.into(OnChainAnchors).entries(anchor);

    LOG.info(`Published report '${reportId}': build ${buildResult.buildId}`);

    return {
      buildId: buildResult.buildId,
      unsignedCbor: buildResult.unsignedCbor,
      txBodyHash: buildResult.txBodyHash,
      anchorId
    };
  }

  // ─── SubmitSigned ────────────────────────────────────────────────────────

  private async _handleSubmitSigned(req: Request) {
    const { buildId, signedTxCbor } = req.data;

    // Find anchor by buildId
    const anchor = await SELECT.one.from(OnChainAnchors).where({ buildId });
    if (!anchor) {
      return req.reject(404, `No anchor found for build '${buildId}'`);
    }
    if (anchor.status !== 'PENDING') {
      return req.reject(400, `Anchor status '${anchor.status}' — expected PENDING`);
    }
    if (!anchor.signingRequestId) {
      return req.reject(400, `Anchor '${anchor.ID}' has no signing request — re-publish to create one`);
    }

    // Ownership check via linked tx or report
    await _requireAnchorOwnership(req, anchor);

    // Submit via ODATANO CardanoSignService (handles CIP-30 witness-set auto-merge).
    // No address passed: connected wallet at publish-time may differ from org.walletAddress,
    // and ODATANO's verifyOrThrow on the signature is the real security gate.
    const result = await chain.submitSigned(anchor.signingRequestId, signedTxCbor);

    // Update anchor
    await UPDATE(OnChainAnchors).where({ ID: anchor.ID }).set({
      txHash: result.txHash,
      status: 'SUBMITTED',
      signedCbor: signedTxCbor,
      submittedAt: new Date().toISOString()
    });

    // Update linked entity status
    if (anchor.transaction_ID) {
      await UPDATE(Transactions).where({ ID: anchor.transaction_ID }).set({ status: 'PUBLISHED' });
    }
    if (anchor.report_ID) {
      await UPDATE(FinancialReports).where({ ID: anchor.report_ID }).set({ status: 'PUBLISHED' });
    }

    LOG.info(`Submitted build '${buildId}' → TX ${result.txHash}`);

    return {
      txHash: result.txHash,
      status: result.status
    };
  }

  // ─── CheckPendingAnchors (Polling) ───────────────────────────────────────

  private async _handleCheckPendingAnchors(_req: Request) {
    return this._pollPendingAnchors();
  }

  private async _pollPendingAnchors(): Promise<{ updated: number }> {
    const pending = await SELECT.from(OnChainAnchors)
      .where({ status: 'SUBMITTED' })
      .and('txHash is not null');

    let updated = 0;

    for (const anchor of pending) {
      if (!anchor.txHash) continue;  // SQL filter guarantees this, narrow for TS
      try {
        const status = await chain.getTxStatus(anchor.txHash);

        if (status.confirmed) {
          await UPDATE(OnChainAnchors).where({ ID: anchor.ID }).set({
            status: 'CONFIRMED',
            slot: status.slot,
            blockNumber: status.blockNumber,
            confirmedAt: new Date().toISOString()
          });

          // Update linked entity
          if (anchor.transaction_ID) {
            await UPDATE(Transactions).where({ ID: anchor.transaction_ID }).set({ status: 'CONFIRMED' });
          }
          if (anchor.report_ID) {
            await UPDATE(FinancialReports).where({ ID: anchor.report_ID }).set({ status: 'CONFIRMED' });
          }

          LOG.info(`Confirmed: TX ${anchor.txHash} (slot ${status.slot})`);
          updated++;
        }
      } catch (err: any) {
        LOG.warn(`Polling error for TX ${anchor.txHash}:`, err.message);
      }
    }

    return { updated };
  }

  // ─── RetryFailed ─────────────────────────────────────────────────────────

  private async _handleRetryFailed(req: Request) {
    const { anchorId } = req.data;

    const anchor = await SELECT.one.from(OnChainAnchors).where({ ID: anchorId });
    if (!anchor) {
      return req.reject(404, 'Anchor not found');
    }
    if (anchor.status !== 'FAILED') {
      return req.reject(400, `Anchor status '${anchor.status}' — expected FAILED`);
    }

    // Ownership check
    await _requireAnchorOwnership(req, anchor);

    // Rebuild: find the original data and re-publish
    let metadata: any;
    let walletAddress: string;

    if (anchor.transaction_ID) {
      const tx = await SELECT.one.from(Transactions)
        .where({ ID: anchor.transaction_ID })
        .columns(col => { col('*'); col.items(item => item('*')); });
      const org = await SELECT.one.from(Organisations).where({ ID: tx?.org_ID });
      if (!tx || !org?.walletAddress) return req.reject(400, 'Cannot rebuild — data missing');
      metadata = buildTransactionMetadata([tx], org);
      walletAddress = org.walletAddress;
    } else if (anchor.report_ID) {
      const report = await SELECT.one.from(FinancialReports)
        .where({ ID: anchor.report_ID })
        .columns(col => { col('*'); col.entries(e => e('*')); });
      const org = await SELECT.one.from(Organisations).where({ ID: report?.org_ID });
      if (!report || !org?.walletAddress) return req.reject(400, 'Cannot rebuild — data missing');
      metadata = buildReportMetadata(report, report.entries || [], org);
      walletAddress = org.walletAddress;
    } else {
      return req.reject(400, 'Anchor has no linked transaction or report');
    }

    const buildResult = await chain.buildMetadataTx(metadata, walletAddress);
    const signingRequestId = await chain.createSigningRequest(
      buildResult.buildId,
      `FINCA retry ${anchorId}`
    );

    await UPDATE(OnChainAnchors).where({ ID: anchorId }).set({
      buildId: buildResult.buildId,
      signingRequestId,
      unsignedCbor: buildResult.unsignedCbor,
      txBodyHash: buildResult.txBodyHash,
      status: 'PENDING',
      errorMessage: null
    });

    return {
      buildId: buildResult.buildId,
      unsignedCbor: buildResult.unsignedCbor,
      txBodyHash: buildResult.txBodyHash
    };
  }

  // ─── ValidateBatch ───────────────────────────────────────────────────────

  private async _handleValidateBatch(req: Request) {
    const { batchId } = req.data;

    const txs = await SELECT.from(Transactions)
      .where({ batchId })
      .columns(col => { col('*'); col.items(item => item('*')); });

    if (!txs || txs.length === 0) {
      return req.reject(404, `No transactions found for batch '${batchId}'`);
    }

    // Ownership check
    await _requireOrg(req, txs[0].org_ID);

    const errors: string[] = [];

    for (const tx of txs) {
      // Basic validations
      if (!tx.date) {
        errors.push(`TX ${tx.transactionNumber || tx.ID}: Missing date`);
      }
      if (!tx.items || tx.items.length === 0) {
        errors.push(`TX ${tx.transactionNumber || tx.ID}: No line items`);
      }

      // Double-entry check: sum of all items must be exactly zero (string-decimal arithmetic — no float drift)
      if (tx.items && tx.items.length > 0) {
        const sum = sumDecimalsExact(tx.items.map((i: any) => i.amount));
        if (sum !== '0.00') {
          errors.push(`TX ${tx.transactionNumber || tx.ID}: Items don't balance (sum: ${sum})`);
        }
      }

      // Account code check
      for (const item of (tx.items || [])) {
        if (!item.accountCode) {
          errors.push(`TX ${tx.transactionNumber || tx.ID}, line ${item.lineNumber}: Missing account code`);
        }
      }
    }

    // Update status if valid
    if (errors.length === 0) {
      for (const tx of txs) {
        if (tx.status === 'DRAFT') {
          await UPDATE(Transactions).where({ ID: tx.ID }).set({ status: 'VALIDATED' });
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ─── VerifyTransaction ───────────────────────────────────────────────────

  private async _handleVerifyTransaction(req: Request) {
    const { txHash } = req.data;
    const userId = req.user?.id;
    if (!userId || userId === 'anonymous') {
      return req.reject(401, 'Sign in required');
    }

    // Get on-chain metadata
    const onChainMetadata = await chain.getOnChainMetadata(txHash);
    const label1447 = onChainMetadata.find(m => m.label === '1447');

    if (!label1447) {
      return { verified: false, onChainData: JSON.stringify(onChainMetadata), localMatch: false };
    }

    // localMatch only true if anchor belongs to caller's wallet
    const anchor = await SELECT.one.from(OnChainAnchors).where({ txHash });
    let ownedLocally = false;
    if (anchor) {
      try {
        await _requireAnchorOwnership(req, anchor);
        ownedLocally = true;
      } catch { /* not owned — keep localMatch=false */ }
    }

    return {
      verified: true,
      onChainData: label1447.payload,
      localMatch: ownedLocally
    };
  }

  // ─── VerifyReport ────────────────────────────────────────────────────────

  private async _handleVerifyReport(req: Request) {
    const { reportId } = req.data;

    // First load report and check ownership (avoid leaking existence of others' reports)
    const report = await SELECT.one.from(FinancialReports).where({ ID: reportId });
    if (!report) return req.reject(404, 'Report not found');
    await _requireOrg(req, report.org_ID);

    const anchor = await SELECT.one.from(OnChainAnchors)
      .where({ report_ID: reportId, status: 'CONFIRMED' });

    if (!anchor?.txHash) {
      return { verified: false, onChainData: '', localMatch: false };
    }

    const onChainMetadata = await chain.getOnChainMetadata(anchor.txHash);
    const label1447 = onChainMetadata.find(m => m.label === '1447');

    return {
      verified: !!label1447,
      onChainData: label1447?.payload || '',
      localMatch: true
    };
  }

  // ─── Polling ─────────────────────────────────────────────────────────────

  private _startPolling() {
    const POLL_INTERVAL_MS = 30_000; // 30 seconds

    this.pollingInterval = setInterval(async () => {
      try {
        const result = await this._pollPendingAnchors();
        if (result.updated > 0) {
          LOG.info(`Polling: ${result.updated} anchor(s) confirmed`);
        }
      } catch (err: any) {
        LOG.warn('Polling error:', err.message);
      }
    }, POLL_INTERVAL_MS);

    LOG.info('Anchor polling started (30s interval)');
  }

  private _stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      LOG.info('Anchor polling stopped');
    }
  }
}

export default FinanceService;

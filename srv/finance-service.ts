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

class FinanceService extends ApplicationService {
  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  async init() {
    // ─── Action Handlers ─────────────────────────────────────────────────

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

  // ─── PublishTransactions ─────────────────────────────────────────────────

  private async _handlePublishTransactions(req: Request) {
    const { batchId, walletAddress } = req.data;

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

    // 2. Load organisation
    const orgId = txs[0].org_ID;
    const org = await SELECT.one.from(Organisations).where({ ID: orgId });
    if (!org) {
      return req.reject(404, 'Organisation not found');
    }

    // Use connected wallet address (from frontend), fall back to org's stored address
    const senderAddress = walletAddress || org.walletAddress;
    if (!senderAddress) {
      return req.reject(400, 'No wallet address provided and organisation has none configured');
    }

    // 3. Build 1447 metadata
    const metadata = buildTransactionMetadata(txs, org);

    // Check size limit
    const size = estimateMetadataSize(metadata);
    if (size > MAX_METADATA_BYTES) {
      return req.reject(400, `Metadata too large (${size} bytes). Max: ${MAX_METADATA_BYTES}. Split into smaller batches.`);
    }

    // 4. Build unsigned TX via ODATANO (using connected wallet address)
    const buildResult = await chain.buildMetadataTx(metadata, senderAddress);

    // 5. Create OnChainAnchor record (UUID generated up-front for consistent return value)
    const anchorId = randomUUID();
    const anchor = {
      ID: anchorId,
      transaction_ID: txs[0].ID,  // Link to first TX in batch
      buildId: buildResult.buildId,
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
    const { reportId, walletAddress } = req.data;

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

    // 2. Load organisation
    const org = await SELECT.one.from(Organisations).where({ ID: report.org_ID });
    if (!org) {
      return req.reject(404, 'Organisation not found');
    }

    const senderAddress = walletAddress || org.walletAddress;
    if (!senderAddress) {
      return req.reject(400, 'No wallet address provided and organisation has none configured');
    }

    // 3. Build 1447 metadata
    const metadata = buildReportMetadata(report, report.entries || [], org);
    const size = estimateMetadataSize(metadata);
    if (size > MAX_METADATA_BYTES) {
      return req.reject(400, `Report metadata too large (${size} bytes). Max: ${MAX_METADATA_BYTES}.`);
    }

    // 4. Build unsigned TX (using connected wallet address)
    const buildResult = await chain.buildMetadataTx(metadata, senderAddress);

    // 5. Create anchor (UUID generated up-front for consistent return value)
    const anchorId = randomUUID();
    const anchor = {
      ID: anchorId,
      report_ID: reportId,
      buildId: buildResult.buildId,
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

    // Submit via ODATANO
    const result = await chain.submitSigned(buildId, signedTxCbor);

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

    await UPDATE(OnChainAnchors).where({ ID: anchorId }).set({
      buildId: buildResult.buildId,
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

    // Get on-chain metadata
    const onChainMetadata = await chain.getOnChainMetadata(txHash);
    const label1447 = onChainMetadata.find(m => m.label === '1447');

    if (!label1447) {
      return { verified: false, onChainData: JSON.stringify(onChainMetadata), localMatch: false };
    }

    // Find local anchor by txHash
    const anchor = await SELECT.one.from(OnChainAnchors).where({ txHash });

    return {
      verified: true,
      onChainData: label1447.payload,
      localMatch: !!anchor
    };
  }

  // ─── VerifyReport ────────────────────────────────────────────────────────

  private async _handleVerifyReport(req: Request) {
    const { reportId } = req.data;

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

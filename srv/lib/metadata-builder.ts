/**
 * Reeve-compatible Metadata Builder (Label 1447)
 *
 * Serializes FINCA CDS entities into the Cardano Foundation's Reeve on-chain
 * metadata format for financial data anchoring.
 *
 * Spec: https://docs.reeve.technology/metadataFormat
 */

/** 1447 metadata envelope. `data` shape depends on `type`:
 *   - INDIVIDUAL_TRANSACTIONS → TransactionData[]
 *   - REPORT                  → hierarchical category map */
interface Metadata1447 {
  '1447': {
    org: OrgBlock;
    metadata: MetadataBlock;
    type: 'INDIVIDUAL_TRANSACTIONS' | 'REPORT';
    data?: TransactionData[] | Record<string, any>;
    // REPORT fields
    subType?: 'BALANCE_SHEET' | 'INCOME_STATEMENT';
    interval?: string;
    year?: string;
    mode?: string;
    ver?: string;
    period?: string;
  };
}

interface OrgBlock {
  id: string;
  name: string;
  currency_id: string;
  country_code: string;
  tax_id_number: string;
}

interface MetadataBlock {
  creation_slot?: number;
  timestamp: string;
  version: string;
}

interface TransactionData {
  id: string;
  number: string;
  batch_id: string;
  type: string;
  date: string;
  accounting_period: string;
  items: TransactionItemData[];
}

interface TransactionItemData {
  id: string;
  amount: string;
  event?: { code: string; name: string };
  project?: { cust_code: string; name: string };
  cost_center?: { cust_code: string; name: string };
  fx_rate?: string;
  document?: {
    number: string;
    currency?: { id: string; cust_code: string };
    vat?: { cust_code: string; rate: string };
    counterparty?: { cust_code: string; type: string };
  };
}

/**
 * Build Label-1447 metadata for a batch of transactions.
 */
export function buildTransactionMetadata(
  transactions: any[],
  org: any,
  periodLabel?: string
): Metadata1447 {
  return {
    '1447': {
      org: buildOrgBlock(org),
      metadata: {
        timestamp: new Date().toISOString(),
        version: '1.1'
      },
      type: 'INDIVIDUAL_TRANSACTIONS',
      data: transactions.map(tx => serializeTransaction(tx, periodLabel))
    }
  };
}

/**
 * Build Label-1447 metadata for a financial report (Balance Sheet or Income Statement).
 */
export function buildReportMetadata(
  report: any,
  entries: any[],
  org: any
): Metadata1447 {
  const reportData = buildReportData(report.subType, entries);

  return {
    '1447': {
      org: buildOrgBlock(org),
      metadata: {
        timestamp: new Date().toISOString(),
        version: '1.1'
      },
      type: 'REPORT',
      subType: report.subType,
      interval: report.interval || 'ANNUAL',
      year: String(report.year),
      mode: report.mode || 'ACTUAL',
      ver: report.version || '1.0',
      period: report.period?.period,
      data: reportData
    }
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function buildOrgBlock(org: any): OrgBlock {
  return {
    id: org.ID,
    name: org.name,
    currency_id: org.currencyCode,
    country_code: org.countryCode,
    tax_id_number: org.taxIdNumber || ''
  };
}

function serializeTransaction(tx: any, periodLabel?: string): TransactionData {
  return {
    id: tx.ID,
    number: tx.transactionNumber || '',
    batch_id: tx.batchId || '',
    type: tx.type || 'JOURNAL',
    date: tx.date ? String(tx.date) : '',
    accounting_period: periodLabel || tx.period?.period || '',
    items: (tx.items || []).map(serializeItem)
  };
}

function serializeItem(item: any): TransactionItemData {
  const result: TransactionItemData = {
    id: item.ID,
    amount: String(item.amount)
  };

  if (item.eventCode) {
    result.event = { code: item.eventCode, name: item.eventName || '' };
  }
  if (item.projectCode) {
    result.project = { cust_code: item.projectCode, name: item.projectName || '' };
  }
  if (item.costCenterCode) {
    result.cost_center = { cust_code: item.costCenterCode, name: item.costCenterName || '' };
  }
  if (item.fxRate) {
    result.fx_rate = String(item.fxRate);
  }
  if (item.docNumber) {
    result.document = {
      number: item.docNumber,
      currency: item.currencyCode ? { id: item.currencyCode, cust_code: item.currencyCode } : undefined,
      vat: item.vatCode ? { cust_code: item.vatCode, rate: String(item.vatRate || '') } : undefined,
      counterparty: item.counterpartyCode ? { cust_code: item.counterpartyCode, type: item.counterpartyType || '' } : undefined
    };
  }

  return result;
}

/**
 * Build hierarchical report data from flat ReportEntries.
 * Groups by category → subCategory → lineItems.
 */
function buildReportData(subType: string, entries: any[]): Record<string, any> {
  const data: Record<string, any> = {};

  // Sort entries by sortOrder
  const sorted = [...entries].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  for (const entry of sorted) {
    const cat = entry.category || 'OTHER';
    const subCat = entry.subCategory;
    const lineItem = entry.lineItem;

    if (!data[cat]) {
      data[cat] = {};
    }

    if (subCat && lineItem) {
      if (!data[cat][subCat]) {
        data[cat][subCat] = {};
      }
      data[cat][subCat][lineItem] = String(entry.amount);
    } else if (subCat) {
      data[cat][subCat] = String(entry.amount);
    } else {
      data[cat] = String(entry.amount);
    }
  }

  return data;
}

/**
 * Estimate serialized metadata size in bytes.
 * Cardano TX metadata limit is ~16KB.
 */
export function estimateMetadataSize(metadata: Metadata1447): number {
  return Buffer.byteLength(JSON.stringify(metadata), 'utf-8');
}

/** Max metadata payload size (conservative, leaves room for TX overhead) */
export const MAX_METADATA_BYTES = 14_000;

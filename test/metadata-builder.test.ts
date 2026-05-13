import {
  buildTransactionMetadata,
  buildReportMetadata,
  estimateMetadataSize,
  MAX_METADATA_BYTES
} from '../srv/lib/metadata-builder';

const ORG = {
  ID: 'org-uuid-1',
  name: 'FINCA Demo',
  currencyCode: 'EUR',
  countryCode: 'DE',
  taxIdNumber: 'DE123456789'
};

describe('metadata-builder — Reeve label-1447 conformance', () => {
  describe('buildTransactionMetadata', () => {
    test('produces correct envelope structure', () => {
      const tx = {
        ID: 'tx-1', transactionNumber: 'TX-001', batchId: 'B-1', type: 'JOURNAL',
        date: '2025-01-15', items: []
      };
      const meta = buildTransactionMetadata([tx], ORG);

      expect(meta).toHaveProperty('1447');
      expect(meta['1447'].type).toBe('INDIVIDUAL_TRANSACTIONS');
      expect(meta['1447'].metadata.version).toBe('1.1');
      expect(meta['1447'].metadata.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('maps org block to Reeve field names (currency_id, country_code, tax_id_number)', () => {
      const meta = buildTransactionMetadata([], ORG);
      expect(meta['1447'].org).toEqual({
        id: 'org-uuid-1',
        name: 'FINCA Demo',
        currency_id: 'EUR',
        country_code: 'DE',
        tax_id_number: 'DE123456789'
      });
    });

    test('serializes amount as string (Reeve precision requirement)', () => {
      const tx = {
        ID: 'tx-1', transactionNumber: 'TX-001', batchId: 'B-1', type: 'JOURNAL',
        date: '2025-01-15',
        items: [{ ID: 'item-1', amount: '3500.00', accountCode: '6300' }]
      };
      const meta = buildTransactionMetadata([tx], ORG);
      const item = (meta['1447'].data as any)[0].items[0];
      expect(item.amount).toBe('3500.00');
      expect(typeof item.amount).toBe('string');
    });

    test('omits optional sub-objects when source fields absent', () => {
      const tx = {
        ID: 'tx-1', transactionNumber: 'TX-001', batchId: 'B-1', type: 'JOURNAL',
        date: '2025-01-15',
        items: [{ ID: 'item-1', amount: '100.00' }]
      };
      const meta = buildTransactionMetadata([tx], ORG);
      const item = (meta['1447'].data as any)[0].items[0];
      expect(item.event).toBeUndefined();
      expect(item.project).toBeUndefined();
      expect(item.cost_center).toBeUndefined();
      expect(item.document).toBeUndefined();
    });

    test('includes event/project/cost_center/fx_rate when set on item', () => {
      const tx = {
        ID: 'tx-1', transactionNumber: 'TX-001', batchId: 'B-1', type: 'JOURNAL',
        date: '2025-01-15',
        items: [{
          ID: 'item-1', amount: '100.00',
          eventCode: 'E1', eventName: 'Event One',
          projectCode: 'P1', projectName: 'Project One',
          costCenterCode: 'CC1', costCenterName: 'Cost Center One',
          fxRate: '1.0537'
        }]
      };
      const meta = buildTransactionMetadata([tx], ORG);
      const item = (meta['1447'].data as any)[0].items[0];
      expect(item.event).toEqual({ code: 'E1', name: 'Event One' });
      expect(item.project).toEqual({ cust_code: 'P1', name: 'Project One' });
      expect(item.cost_center).toEqual({ cust_code: 'CC1', name: 'Cost Center One' });
      expect(item.fx_rate).toBe('1.0537');
    });

    test('defaults event/project/cost_center name to empty string when only code is set', () => {
      const tx = {
        ID: 'tx-1', transactionNumber: 'TX-001', batchId: 'B-1', type: 'JOURNAL',
        date: '2025-01-15',
        items: [{
          ID: 'item-1', amount: '100.00',
          eventCode: 'E1', projectCode: 'P1', costCenterCode: 'CC1'
        }]
      };
      const meta = buildTransactionMetadata([tx], ORG);
      const item = (meta['1447'].data as any)[0].items[0];
      expect(item.event.name).toBe('');
      expect(item.project.name).toBe('');
      expect(item.cost_center.name).toBe('');
    });

    test('builds full document block when fields present', () => {
      const tx = {
        ID: 'tx-1', transactionNumber: 'TX-001', batchId: 'B-1', type: 'JOURNAL',
        date: '2025-01-15',
        items: [{
          ID: 'item-1', amount: '3500.00',
          docNumber: 'RE-2025-0012',
          currencyCode: 'EUR',
          vatCode: 'V19', vatRate: '19.00',
          counterpartyCode: 'IMMOBILIEN-AG', counterpartyType: 'VENDOR'
        }]
      };
      const meta = buildTransactionMetadata([tx], ORG);
      const doc = (meta['1447'].data as any)[0].items[0].document!;
      expect(doc.number).toBe('RE-2025-0012');
      expect(doc.currency).toEqual({ id: 'EUR', cust_code: 'EUR' });
      expect(doc.vat).toEqual({ cust_code: 'V19', rate: '19.00' });
      expect(doc.counterparty).toEqual({ cust_code: 'IMMOBILIEN-AG', type: 'VENDOR' });
    });
  });

  describe('buildReportMetadata', () => {
    test('produces REPORT envelope with required fields', () => {
      const report = { subType: 'BALANCE_SHEET', year: 2025, interval: 'ANNUAL', mode: 'ACTUAL', version: '1.0' };
      const meta = buildReportMetadata(report, [], ORG);

      expect(meta['1447'].type).toBe('REPORT');
      expect(meta['1447'].subType).toBe('BALANCE_SHEET');
      expect(meta['1447'].year).toBe('2025');     // string, per spec
      expect(meta['1447'].interval).toBe('ANNUAL');
      expect(meta['1447'].mode).toBe('ACTUAL');
      expect(meta['1447'].ver).toBe('1.0');
    });

    test('builds 3-level hierarchy: category → subCategory → lineItem', () => {
      const entries = [
        { category: 'ASSETS', subCategory: 'CURRENT_ASSETS', lineItem: 'Cash', amount: '1000.00', sortOrder: 1 },
        { category: 'ASSETS', subCategory: 'CURRENT_ASSETS', lineItem: 'Receivables', amount: '500.00', sortOrder: 2 },
        { category: 'ASSETS', subCategory: 'NON_CURRENT', lineItem: 'PPE', amount: '5000.00', sortOrder: 3 }
      ];
      const meta = buildReportMetadata({ subType: 'BALANCE_SHEET', year: 2025 }, entries, ORG);
      const data = meta['1447'].data as any;

      expect(data.ASSETS.CURRENT_ASSETS.Cash).toBe('1000.00');
      expect(data.ASSETS.CURRENT_ASSETS.Receivables).toBe('500.00');
      expect(data.ASSETS.NON_CURRENT.PPE).toBe('5000.00');
    });

    test('collapses to single number when category has no subCategory', () => {
      const entries = [
        { category: 'NET_INCOME', amount: '12500.00', sortOrder: 1 }
      ];
      const meta = buildReportMetadata({ subType: 'INCOME_STATEMENT', year: 2025 }, entries, ORG);
      const data = meta['1447'].data as any;
      expect(data.NET_INCOME).toBe('12500.00');
    });

    test('collapses to subCategory value when no lineItem is set', () => {
      const entries = [
        { category: 'ASSETS', subCategory: 'TOTAL', amount: '5000.00', sortOrder: 1 }
      ];
      const meta = buildReportMetadata({ subType: 'BALANCE_SHEET', year: 2025 }, entries, ORG);
      const data = meta['1447'].data as any;
      expect(data.ASSETS.TOTAL).toBe('5000.00');
    });

    test('falls back to OTHER bucket when entry has no category', () => {
      const entries = [
        { amount: '42.00', sortOrder: 1 }
      ];
      const meta = buildReportMetadata({ subType: 'BALANCE_SHEET', year: 2025 }, entries, ORG);
      const data = meta['1447'].data as any;
      expect(data.OTHER).toBe('42.00');
    });

    test('applies defaults for missing optional fields', () => {
      const meta = buildReportMetadata({ subType: 'INCOME_STATEMENT', year: 2025 }, [], ORG);
      expect(meta['1447'].interval).toBe('ANNUAL');
      expect(meta['1447'].mode).toBe('ACTUAL');
      expect(meta['1447'].ver).toBe('1.0');
    });
  });

  describe('size limits', () => {
    test('estimateMetadataSize returns byte length', () => {
      const meta = buildTransactionMetadata([], ORG);
      const size = estimateMetadataSize(meta);
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(MAX_METADATA_BYTES);
    });

    test('rejects payload over 14KB', () => {
      const items = Array.from({ length: 200 }, (_, i) => ({
        ID: `item-${i}`, amount: '100.00',
        docNumber: `RE-${i}`, currencyCode: 'EUR',
        vatCode: 'V19', vatRate: '19.00',
        counterpartyCode: 'CP-' + i, counterpartyType: 'VENDOR'
      }));
      const txs = Array.from({ length: 50 }, (_, i) => ({
        ID: `tx-${i}`, transactionNumber: `T-${i}`, batchId: 'B', type: 'JOURNAL',
        date: '2025-01-15', items
      }));
      const meta = buildTransactionMetadata(txs, ORG);
      expect(estimateMetadataSize(meta)).toBeGreaterThan(MAX_METADATA_BYTES);
    });
  });
});

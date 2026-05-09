namespace finca;

using { cuid, managed, temporal } from '@sap/cds/common';

// ─── Organisation (analog Reeve "org" Objekt) ───────────────────────────────

entity Organisations : cuid, managed {
  name          : String(255)  @mandatory;
  currencyCode  : String(3)    @mandatory;  // ISO 4217 (EUR, USD, ADA)
  countryCode   : String(2)    @mandatory;  // ISO 3166-1 alpha-2
  taxIdNumber   : String(50);
  walletAddress : String(200);              // Cardano bech32 Publishing-Wallet
  periods       : Composition of many AccountingPeriods on periods.org = $self;
  transactions  : Composition of many Transactions on transactions.org = $self;
  reports       : Composition of many FinancialReports on reports.org = $self;
}

// ─── Accounting Periode ──────────────────────────────────────────────────────

entity AccountingPeriods : cuid, managed {
  org       : Association to Organisations @mandatory;
  period    : String(10)  @mandatory;       // z.B. "2024-Q4", "2025-01"
  year      : Integer     @mandatory;
  startDate : Date        @mandatory;
  endDate   : Date        @mandatory;
  status    : String(20) default 'OPEN';    // OPEN, CLOSED, PUBLISHED
}

// ─── Buchungstransaktion ─────────────────────────────────────────────────────

entity Transactions : cuid, managed {
  org               : Association to Organisations      @mandatory;
  period            : Association to AccountingPeriods;
  transactionNumber : String(50);
  batchId           : String(50);           // Gruppierung für Batch-Publishing
  type              : String(50);           // JOURNAL, PAYMENT, INVOICE, CREDIT_NOTE
  date              : Date                  @mandatory;
  description       : String(500);
  status            : String(20) default 'DRAFT';  // DRAFT, VALIDATED, PUBLISHED, CONFIRMED
  items             : Composition of many TransactionItems on items.transaction = $self;
  anchors           : Composition of many OnChainAnchors on anchors.transaction = $self;
}

// ─── Buchungszeilen ──────────────────────────────────────────────────────────

entity TransactionItems : cuid {
  transaction     : Association to Transactions @mandatory;
  lineNumber      : Integer;
  accountCode     : String(20)   @mandatory;
  accountName     : String(100);
  amount          : Decimal(23,2) @mandatory;   // Positiv = Soll, Negativ = Haben
  currencyCode    : String(3);
  fxRate          : Decimal(15,6);
  costCenterCode  : String(20);
  costCenterName  : String(100);
  projectCode     : String(20);
  projectName     : String(100);
  eventCode       : String(20);
  eventName       : String(100);
  docNumber       : String(50);
  vatCode         : String(10);
  vatRate         : Decimal(5,2);
  counterpartyCode: String(50);
  counterpartyType: String(20);   // VENDOR, CUSTOMER, EMPLOYEE, INTERCOMPANY
}

// ─── Financial Reports (Balance Sheet, Income Statement) ─────────────────────

entity FinancialReports : cuid, managed {
  org       : Association to Organisations      @mandatory;
  period    : Association to AccountingPeriods;
  subType   : String(30)  @mandatory;       // BALANCE_SHEET, INCOME_STATEMENT
  year      : Integer     @mandatory;
  interval  : String(20)  default 'ANNUAL'; // ANNUAL, QUARTERLY, MONTHLY
  mode      : String(20)  default 'ACTUAL'; // ACTUAL, BUDGET, FORECAST
  version   : String(10)  default '1.0';
  status    : String(20)  default 'DRAFT';  // DRAFT, APPROVED, PUBLISHED, CONFIRMED
  entries   : Composition of many ReportEntries on entries.report = $self;
  anchors   : Composition of many OnChainAnchors on anchors.report = $self;
}

// ─── Report-Zeilen (hierarchisch) ────────────────────────────────────────────

entity ReportEntries : cuid {
  report      : Association to FinancialReports @mandatory;
  parentEntry : Association to ReportEntries;
  category    : String(50)   @mandatory;    // ASSETS, LIABILITIES, CAPITAL, REVENUE, EXPENSES
  subCategory : String(100);                // NON_CURRENT_ASSETS, CURRENT_ASSETS, etc.
  lineItem    : String(200);                // Property/Plant/Equipment, Cash, etc.
  amount      : Decimal(23,2) @mandatory;
  sortOrder   : Integer;
}

// ─── On-Chain Anchoring Records ──────────────────────────────────────────────

entity OnChainAnchors : cuid, managed {
  transaction   : Association to Transactions;
  report        : Association to FinancialReports;
  txHash        : String(64);               // Cardano TX Hash (Blake2b-256)
  slot          : Int64;
  blockNumber   : Int64;
  metadataLabel : Integer default 1447;
  status        : String(20) default 'PENDING';  // PENDING, SUBMITTED, CONFIRMED, FAILED
  submittedAt   : Timestamp;
  confirmedAt   : Timestamp;
  errorMessage  : String(500);
  // ODATANO Build/Signing References
  buildId       : String(100);             // ODATANO Build-ID (UUID)
  unsignedCbor  : LargeString;
  signedCbor    : LargeString;
  txBodyHash    : String(64);
}

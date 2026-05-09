using { finca } from '../db/schema';

service FinanceService @(path: '/odata/v4/finance') {

  // ─── CRUD Entities ──────────────────────────────────────────────────────────

  entity Organisations    as projection on finca.Organisations;
  entity AccountingPeriods as projection on finca.AccountingPeriods;
  entity Transactions     as projection on finca.Transactions;
  entity TransactionItems as projection on finca.TransactionItems;
  entity FinancialReports as projection on finca.FinancialReports;
  entity ReportEntries    as projection on finca.ReportEntries;
  entity OnChainAnchors   as projection on finca.OnChainAnchors;

  // ─── Publishing Actions ─────────────────────────────────────────────────────

  @title: 'Publish Transaction Batch'
  @description: 'Serializes transactions in Reeve 1447 format and builds unsigned metadata TX via ODATANO'
  action PublishTransactions(
    @title: 'Batch ID' @mandatory
    batchId : String,
    @title: 'Wallet Address'
    @description: 'Connected CIP-30 wallet bech32 address (sender/change). If omitted, falls back to org walletAddress.'
    walletAddress : String
  ) returns {
    buildId      : String;
    unsignedCbor : LargeString;
    txBodyHash   : String;
    anchorId     : UUID;
  };

  @title: 'Publish Financial Report'
  @description: 'Serializes report in Reeve 1447 format and builds unsigned metadata TX via ODATANO'
  action PublishReport(
    @title: 'Report ID' @mandatory
    reportId : UUID,
    @title: 'Wallet Address'
    @description: 'Connected CIP-30 wallet bech32 address (sender/change). If omitted, falls back to org walletAddress.'
    walletAddress : String
  ) returns {
    buildId      : String;
    unsignedCbor : LargeString;
    txBodyHash   : String;
    anchorId     : UUID;
  };

  // ─── Signing & Submission ───────────────────────────────────────────────────

  @title: 'Submit Signed Transaction'
  @description: 'Submits externally signed transaction (CIP-30 wallet) to blockchain via ODATANO'
  action SubmitSigned(
    @title: 'Build ID' @mandatory
    buildId      : String,
    @title: 'Signed TX CBOR' @mandatory
    signedTxCbor : LargeString
  ) returns {
    txHash : String;
    status : String;
  };

  // ─── Monitoring ─────────────────────────────────────────────────────────────

  @title: 'Check Pending Anchors'
  @description: 'Polls blockchain for confirmation of SUBMITTED anchors'
  action CheckPendingAnchors() returns {
    updated : Integer;
  };

  @title: 'Retry Failed Anchor'
  @description: 'Rebuilds unsigned TX for a failed anchor'
  action RetryFailed(
    @title: 'Anchor ID' @mandatory
    anchorId : UUID
  ) returns {
    buildId      : String;
    unsignedCbor : LargeString;
    txBodyHash   : String;
  };

  // ─── Validation ─────────────────────────────────────────────────────────────

  @title: 'Validate Transaction Batch'
  @description: 'Validates batch against business rules before publishing'
  action ValidateBatch(
    @title: 'Batch ID' @mandatory
    batchId : String
  ) returns {
    valid  : Boolean;
    errors : array of String;
  };

  // ─── Verification (Public) ──────────────────────────────────────────────────

  @title: 'Verify On-Chain Transaction'
  @description: 'Reads metadata from blockchain and compares with local record'
  function VerifyTransaction(
    @title: 'Cardano TX Hash' @mandatory
    txHash : String
  ) returns {
    verified    : Boolean;
    onChainData : LargeString;
    localMatch  : Boolean;
  };

  @title: 'Verify On-Chain Report'
  @description: 'Reads report metadata from blockchain and compares with local record'
  function VerifyReport(
    @title: 'Report ID' @mandatory
    reportId : UUID
  ) returns {
    verified    : Boolean;
    onChainData : LargeString;
    localMatch  : Boolean;
  };
}

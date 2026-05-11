using { finca } from '../db/schema';

@(requires: 'authenticated-user')
service FinanceService @(path: '/odata/v4/finance') {

  // ─── CRUD Entities (wallet-scoped) ──────────────────────────────────────────
  // Each entity is restricted to rows owned by the connected wallet, identified
  // via the path expression to org.walletAddress = $user.id.

  @(restrict: [{ grant: '*', where: 'walletAddress = $user.id' }])
  entity Organisations    as projection on finca.Organisations;

  @(restrict: [{ grant: '*', where: 'org.walletAddress = $user.id' }])
  entity AccountingPeriods as projection on finca.AccountingPeriods;

  @(restrict: [{ grant: '*', where: 'org.walletAddress = $user.id' }])
  entity Transactions     as projection on finca.Transactions;

  @(restrict: [{ grant: '*', where: 'transaction.org.walletAddress = $user.id' }])
  entity TransactionItems as projection on finca.TransactionItems;

  @(restrict: [{ grant: '*', where: 'org.walletAddress = $user.id' }])
  entity FinancialReports as projection on finca.FinancialReports;

  @(restrict: [{ grant: '*', where: 'report.org.walletAddress = $user.id' }])
  entity ReportEntries    as projection on finca.ReportEntries;

  @(restrict: [{ grant: '*', where: '(transaction.org.walletAddress = $user.id) or (report.org.walletAddress = $user.id)' }])
  entity OnChainAnchors   as projection on finca.OnChainAnchors;

  // ─── Onboarding ─────────────────────────────────────────────────────────────

  @title: 'Provision Org for Wallet'
  @description: 'Returns the org owned by the connected wallet. Creates a fresh draft org if none exists yet (first-time onboarding).'
  action ProvisionOrg(
    @title: 'Org Name (optional, used only on creation)'
    name : String,
    @title: 'Currency Code (ISO 4217, optional, default EUR)'
    currencyCode : String,
    @title: 'Country Code (ISO 3166-1 alpha-2, optional, default DE)'
    countryCode : String
  ) returns {
    ID            : UUID;
    name          : String;
    walletAddress : String;
    created       : Boolean;
  };

  // ─── Publishing Actions ─────────────────────────────────────────────────────

  @title: 'Publish Transaction Batch'
  @description: 'Serializes transactions in Reeve 1447 format and builds unsigned metadata TX via ODATANO. Sender wallet is derived from the JWT-authenticated user.'
  action PublishTransactions(
    @title: 'Batch ID' @mandatory
    batchId : String
  ) returns {
    buildId      : String;
    unsignedCbor : LargeString;
    txBodyHash   : String;
    anchorId     : UUID;
  };

  @title: 'Publish Financial Report'
  @description: 'Serializes report in Reeve 1447 format and builds unsigned metadata TX via ODATANO. Sender wallet is derived from the JWT-authenticated user.'
  action PublishReport(
    @title: 'Report ID' @mandatory
    reportId : UUID
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

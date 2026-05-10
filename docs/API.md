# API: OData V4

All actions are mounted at `/odata/v4/finance/`.

## Publishing

```bash
# Validate a batch against the double-entry rule + required fields
POST ValidateBatch
{ "batchId": "BATCH-2025-Q1" }

# Build an unsigned metadata TX (label 1447) for a transaction batch
POST PublishTransactions
{ "batchId":       "BATCH-2025-Q1",
  "walletAddress": "addr_test1q..." }
→ { "buildId", "unsignedCbor", "txBodyHash", "anchorId" }

# Build an unsigned metadata TX for a financial report
POST PublishReport
{ "reportId":      "<uuid>",
  "walletAddress": "addr_test1q..." }
→ { "buildId", "unsignedCbor", "txBodyHash", "anchorId" }
```

## Signing & Submission

The wallet signs `unsignedCbor` locally (CIP-30 `signTx`), then submit:

```bash
POST SubmitSigned
{ "buildId":      "<uuid>",
  "signedTxCbor": "84a4..." }
→ { "txHash", "status" }
```

## Monitoring & Verification

```bash
POST CheckPendingAnchors    # also runs automatically every 30 s
→ { "updated": 3 }

POST RetryFailed
{ "anchorId": "<uuid>" }
→ { "buildId", "unsignedCbor", "txBodyHash" }

GET  VerifyTransaction(txHash='<cardano-tx-hash>')
→ { "verified", "onChainData", "localMatch" }

GET  VerifyReport(reportId=<uuid>)
→ { "verified", "onChainData", "localMatch" }
```

## Excel integration

The OData V4 feed is consumable directly from Excel with three options:

- **One-click:** [`excel/finca.odc`](../excel/finca.odc) — double-click in Windows.
- **Power Query M template:** [`excel/finca-power-query.m`](../excel/finca-power-query.m) — paste into the Advanced Editor; pre-configured to expand `Transactions.items` and preserve `Decimal(23,2)` precision via `Currency.Type`.
- **Native UI:** *Data → Get Data → From OData Feed* → `http://localhost:4004/odata/v4/finance/`.

Full details and caveats: [`excel/README.md`](../excel/README.md). CORS for Excel-for-the-Web is preconfigured in `srv/server.js`.

> **Read-only.** Excel pulls data via `GET`. POST actions (`PublishTransactions`, `SubmitSigned`, …) need the SAPUI5 frontend, Office Scripts, Power Automate, or VBA.

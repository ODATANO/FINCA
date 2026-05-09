# FINCA — Financial Data Anchoring on Cardano

> **F**inancial **IN**formation **C**hain **A**nchoring: A [Reeve](https://docs.reeve.technology/)-compatible SAP CAP service for cryptographically verifiable anchoring of accounting and financial-report data on the Cardano blockchain. Powered by [@odatano/core](https://www.npmjs.com/package/@odatano/core).

[![Tests](https://img.shields.io/badge/tests-41%20passing-brightgreen)]() [![License](https://img.shields.io/badge/license-Apache%202.0-blue)]()

---

## What FINCA does

FINCA is a self-contained SAP CAP backend that

- manages organisations, journal-style transactions with debit/credit items, and financial reports (Balance Sheet, Income Statement),
- serialises this data into the **CIP-10 label-1447 metadata format** (Reeve spec),
- builds unsigned Cardano transactions via **ODATANO**,
- has them signed by a CIP-30 browser wallet (or server-side) and submitted,
- polls confirmation status and verifies the on-chain anchoring.

## Architecture

```
┌──────────────────────────────────────────────────┐
│              SAP Fiori UI (UI5)                  │
│   Dashboard · Transactions · Reports · Verify    │
│   + CIP-30 Wallet Adapter (Nami, Eternl, Lace)   │
└────────────────────────┬─────────────────────────┘
                         │ OData V4
┌────────────────────────┴─────────────────────────┐
│              SAP CAP Service Layer               │
│  /odata/v4/finance         ← FinanceService      │
│  /odata/v4/cardano-*       ← @odatano/core       │
│                                                   │
│  ┌────────────────────────────────────────────┐  │
│  │  metadata-builder.ts (Reeve-1447 format)   │  │
│  │  chain-adapter.ts    (ODATANO wrapper)     │  │
│  │  decimal.ts          (exact ledger math)   │  │
│  └────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────┘
                         │
                ┌────────┴─────────┐
                │ Cardano Network  │   ← Metadata Label 1447
                │ (preview / preprod / mainnet)
                └──────────────────┘
```

## Data model

| Entity | Purpose |
|---|---|
| `Organisations` | Organisation with bech32 publishing wallet, currency / country / tax ID |
| `AccountingPeriods` | Reporting periods (quarterly / monthly / annual) |
| `Transactions` | Journal header (JOURNAL, PAYMENT, INVOICE, …) with status FSM |
| `TransactionItems` | Debit/credit lines (`Decimal(23,2)`, account code, cost center, VAT, …) |
| `FinancialReports` | BALANCE_SHEET / INCOME_STATEMENT with `subType`, `interval`, `mode`, `version` |
| `ReportEntries` | Hierarchical report rows (category → subCategory → lineItem) |
| `OnChainAnchors` | Bridge to chain: `buildId`, `unsignedCbor`, `signedCbor`, `txHash`, `slot`, status |

**Status FSM for Transactions / Reports:** `DRAFT` → `VALIDATED` → `PUBLISHED` → `CONFIRMED`
**Status FSM for OnChainAnchors:** `PENDING` → `SUBMITTED` → `CONFIRMED` (or `FAILED`)

## Setup

### Prerequisites
- Node.js ≥ 20
- A Cardano wallet (browser extension such as [Lace](https://www.lace.io), [Eternl](https://eternl.io), [Nami](https://www.namiwallet.io)) for signing
- Optional: a Blockfrost API key (https://blockfrost.io) — the free tier is enough for preview/preprod

### Installation
```bash
npm install
cp .env.example .env       # fill in ODATANO config
npm run deploy             # create SQLite + deploy schema + seed CSVs
npm start                  # cds-serve
```

The app runs on `http://localhost:4004` with these endpoints:
- `/odata/v4/finance/` — FINCA OData V4 service
- `/odata/v4/cardano-odata/` — read-only Cardano data (via ODATANO)
- `/odata/v4/cardano-transaction/` — TX build/submit (via ODATANO)
- `/finance/webapp/index.html` — SAPUI5 frontend

### Configuration

ODATANO is configured in `package.json` under `cds.requires.odatano-core` (plugin mode, takes precedence) — `.env` variables from `.env.example` are the standalone-mode fallback.

Default setup (Preview network, Koios backend, Buildooor TX builder):
```json
{
  "cds": {
    "requires": {
      "odatano-core": {
        "network": "preview",
        "backends": ["koios"],
        "txBuilders": ["buildooor"]
      }
    }
  }
}
```

## API — OData V4 actions

All actions are mounted at `/odata/v4/finance/`:

### Publishing

```bash
# Validate a batch against the double-entry rule + required fields
POST ValidateBatch
{ "batchId": "BATCH-2025-Q1" }

# Build an unsigned metadata TX (label 1447) for a transaction batch
POST PublishTransactions
{ "batchId": "BATCH-2025-Q1",
  "walletAddress": "addr_test1q..." }
→ { "buildId", "unsignedCbor", "txBodyHash", "anchorId" }

# Build an unsigned metadata TX for a financial report
POST PublishReport
{ "reportId": "<uuid>",
  "walletAddress": "addr_test1q..." }
→ { "buildId", "unsignedCbor", "txBodyHash", "anchorId" }
```

### Signing & submission

The wallet signs `unsignedCbor` locally (CIP-30 `signTx`), then submit:

```bash
POST SubmitSigned
{ "buildId":      "<uuid>",
  "signedTxCbor": "84a4..." }
→ { "txHash", "status" }
```

### Monitoring & verification

```bash
POST CheckPendingAnchors    # also runs automatically every 30s
→ { "updated": 3 }

POST RetryFailed
{ "anchorId": "<uuid>" }
→ { "buildId", "unsignedCbor", "txBodyHash" }

GET  VerifyTransaction(txHash='<cardano-tx-hash>')
→ { "verified", "onChainData", "localMatch" }

GET  VerifyReport(reportId=<uuid>)
→ { "verified", "onChainData", "localMatch" }
```

## Reeve label-1447 format

FINCA serialises data in the official Reeve format (Cardano Foundation, CIP-10 reserved label `1447`). Example — Individual Transactions:

```json
{
  "1447": {
    "org": {
      "id": "<uuid>",
      "name": "FINCA Demo Organisation",
      "currency_id": "EUR",
      "country_code": "DE",
      "tax_id_number": "DE123456789"
    },
    "metadata": {
      "timestamp": "2025-01-15T10:30:00.000Z",
      "version": "1.1"
    },
    "type": "INDIVIDUAL_TRANSACTIONS",
    "data": [
      {
        "id": "<uuid>",
        "number": "TX-2025-001",
        "batch_id": "BATCH-001",
        "type": "JOURNAL",
        "date": "2025-01-15",
        "items": [
          {
            "id": "<uuid>",
            "amount": "3500.00",
            "cost_center": { "cust_code": "CC-100", "name": "Administration" },
            "document": {
              "number": "RE-2025-0012",
              "currency": { "id": "EUR", "cust_code": "EUR" },
              "vat":      { "cust_code": "V19", "rate": "19.00" },
              "counterparty": { "cust_code": "IMMOBILIEN-AG", "type": "VENDOR" }
            }
          }
        ]
      }
    ]
  }
}
```

Spec: https://docs.reeve.technology/metadataFormat — on-chain reference TXs (Cardano Foundation 2024 financials):
- Balance Sheet TX: `5304b6bfd421005d1ce48507462d84e163d2c7d0a291345ffe15406bb52b5702`
- Income Statement TX: `6cf9c9dbbc208b0cd7af08efa8ed59efffb5f20a05da5519db3efc6dae9209dc`

## Testing

```bash
npm test                # all tests (41 tests in 3 suites)
npm run test:watch      # watch mode
npm run test:coverage   # with coverage report
```

Test layout:
- `test/decimal.test.ts` — exact decimal arithmetic (BigInt-scaled cents) against IEEE-754 drift
- `test/metadata-builder.test.ts` — Reeve-1447 format conformance, hierarchy, size limits
- `test/finance-service.test.ts` — end-to-end integration with `cds.test()` + in-memory SQLite, ODATANO mocked

Test fixtures (Cardano Preview network) ship as CSV seeds in `db/data/`.

## Excel integration

The OData V4 feed is consumable directly from Excel, no middleware needed. Three options:

- **One-click**: [`excel/finca.odc`](excel/finca.odc) — double-click in Windows, Excel opens with the connection ready.
- **Power Query M template**: [`excel/finca-power-query.m`](excel/finca-power-query.m) — paste into the Advanced Editor; pre-configured to expand `Transactions.items` and preserve `Decimal(23,2)` precision via `Currency.Type`.
- **Native UI**: *Data → Get Data → From OData Feed* → `http://localhost:4004/odata/v4/finance/`.

Full instructions and caveats: [`excel/README.md`](excel/README.md). CORS for Excel-for-the-Web origins is preconfigured in `srv/server.js`.

> **Read-only.** Excel pulls data via `GET`. POST actions (`PublishTransactions`, `SubmitSigned`, …) need the SAPUI5 frontend, Office Scripts, Power Automate, or VBA.

## Project structure

```
FINCA/
├── app/finance/webapp/      SAPUI5 frontend (7 views, CIP-30 wallet)
├── excel/                   Excel integration (.odc, .m template, .iqy)
├── db/
│   ├── schema.cds           7 entities (Organisations, Transactions, …)
│   └── data/                CSV seeds (demo org + sample transactions)
├── srv/
│   ├── finance-service.cds  OData V4 service definition
│   ├── finance-service.ts   action handlers (Publish, Sign, Submit, Verify)
│   └── lib/
│       ├── chain-adapter.ts ODATANO wrapper (build / submit / status)
│       ├── metadata-builder.ts Reeve-1447 serialisation
│       └── decimal.ts       exact BigInt decimal arithmetic
├── scripts/deploy-db.js     SQLite deploy + plugin tables + CSV seeding
├── test/                    Jest suites (41 tests)
├── IMPLEMENTATION.MD        Reeve research + ODATANO mapping (DE)
└── .env.example             ODATANO config template
```

## Deployment

### Standalone (dev)
SQLite, local wallet, Preview network as described in *Setup* above.

### Production
- **DB:** SAP HANA via `@cap-js/hana`
- **Network:** `mainnet` in `package.json`
- **Backends:** `["blockfrost", "koios"]` for failover
- **Wallet:** hardware wallet or a dedicated server wallet with limited funds
- **Polling:** the 30 s default is fine for non-time-critical anchoring


## Known limitations

- **Metadata size:** Cardano's per-TX limit is ~16 KB — FINCA caps conservatively at 14 KB. Larger batches must be split (`MAX_METADATA_BYTES` in `srv/lib/metadata-builder.ts`).


## Credits

- **Reeve** — Cardano Foundation (https://github.com/cardano-foundation/cf-reeve-platform)
- **ODATANO** — https://github.com/ODATANO/ODATANO
- **SAP CAP** — https://cap.cloud.sap/

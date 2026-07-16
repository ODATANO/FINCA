![FINCA](datano-finca.png)
# FINCA - Financial Data Anchoring on Cardano

> **F**inancial **IN**formation **C**hain **A**nchoring: A [Reeve](https://docs.reeve.technology/)-compatible SAP CAP service for cryptographically verifiable anchoring of accounting and financial-report data on the Cardano blockchain. Powered by [@odatano/core](https://www.npmjs.com/package/@odatano/core).

[![Tests](https://github.com/ODATANO/FINCA/actions/workflows/test.yaml/badge.svg)](https://github.com/ODATANO/FINCA/actions/workflows/test.yaml)
[![codecov](https://codecov.io/gh/ODATANO/FINCA/branch/main/graph/badge.svg)](https://codecov.io/gh/ODATANO/FINCA)
[![@odatano/core](https://img.shields.io/badge/@odatano/core-1.7.7-blue)](https://www.npmjs.com/package/@odatano/core)
[![License](https://img.shields.io/badge/license-Apache%202.0-yellow)](LICENSE)

FINCA manages organisations, journal-style transactions, and financial reports (Balance Sheet, Income Statement); serialises them into the **CIP-10 label-1447 metadata format** (Reeve spec); builds unsigned Cardano transactions via **ODATANO**; has them signed by a CIP-30 browser wallet; and polls confirmation status.

## Quick start

```bash
npm install
npm run deploy             # SQLite + schema + plugin tables + CSV seeds
cp .env.example .env       # set BLOCKFROST_API_KEY
npm start                  # cds-serve on :4004
npm test                   # vitest (87 tests)
```

Then open <http://localhost:4004/finance/webapp/index.html>.

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
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  metadata-builder.ts (Reeve-1447 format)   │  │
│  │  chain-adapter.ts    (ODATANO wrapper)     │  │
│  │  decimal.ts          (exact ledger math)   │  │
│  └────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────┘
                         │
           ┌─────────────┴─────────────────┐
           │ Cardano Network               │   ← Metadata Label 1447
           │ (preview / preprod / mainnet) │
           └───────────────────────────────┘
```

## Documentation

| Doc | Contents |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Prerequisites, installation, config, auth, production deployment, limits |
| [docs/API.md](docs/API.md) | OData V4 actions (publish/sign/submit/verify) and Excel integration |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Entities, status FSM, Reeve-1447 example, project structure |

## Credits

- **Reeve** Cardano Foundation (<https://github.com/cardano-foundation/cf-reeve-platform>)
- **ODATANO** <https://github.com/ODATANO/ODATANO>
- **SAP CAP** <https://cap.cloud.sap/>

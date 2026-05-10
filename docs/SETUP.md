# Setup & Deployment

## Prerequisites
- Node.js ≥ 20
- A Cardano wallet browser extension ([Lace](https://www.lace.io), [Eternl](https://eternl.io)) for signing
- Optional: Blockfrost or KOIOS API key — free tier suffices for `preview`/`preprod`

## Installation
```bash
npm install
cp .env.example .env       # standalone-mode fallback config
npm run deploy             # SQLite + schema + ODATANO plugin tables + CSV seeds
npm start                  # cds-serve on :4004
```

Endpoints:
- `/odata/v4/finance/` FINCA OData V4
- `/odata/v4/cardano-odata/` read-only Cardano data (ODATANO)
- `/odata/v4/cardano-transaction/` TX build/submit (ODATANO)
- `/finance/webapp/index.html` SAPUI5 frontend

## Configuration

ODATANO is configured in `package.json` under `cds.requires.odatano-core` (plugin mode wins over `.env`):

```json
{
  "cds": {
    "requires": {
      "auth":         { "kind": "dummy" },
      "odatano-core": {
        "network":     "preview",
        "backends":    ["koios"],
        "txBuilders":  ["buildooor"]
      }
    }
  }
}
```

### Auth
- **Dev:** `auth.kind = "dummy"` every request is treated as `authenticated-user`. Required because the SAPUI5 frontend doesn't send Basic-Auth headers.
- **Production:** switch to `xsuaa` in `[production]` profile. Never expose a `dummy`-auth instance.

### TX builder choice
Stick with **Buildooor**. It's battle-tested, supports CIP-10 label-1447 metadata, and has a straightforward API.

## Production
- **DB:** SAP HANA via `@cap-js/hana`
- **Network:** `mainnet` in `package.json`
- **Backends:** `["blockfrost", "koios"]` for failover
- **Wallet:** hardware wallet or a dedicated server wallet with limited funds
- **Polling:** 30 s default is fine for non-time-critical anchoring
- **Auth:** `xsuaa` or equivalent -> see ODATANO Security Guide

## Known limitations
- **Metadata size:** Cardano per-TX limit is ~16 KB; FINCA caps at 14 KB (`MAX_METADATA_BYTES` in `srv/lib/metadata-builder.ts`). Larger batches must be split.

# Data Model & Reeve-1447 Format

## Entities

| Entity | Purpose |
|---|---|
| `Organisations` | Organisation with bech32 publishing wallet, currency / country / tax ID |
| `AccountingPeriods` | Reporting periods (quarterly / monthly / annual) |
| `Transactions` | Journal header (JOURNAL, PAYMENT, INVOICE, …) with status FSM |
| `TransactionItems` | Debit/credit lines (`Decimal(23,2)`, account code, cost center, VAT, …) |
| `FinancialReports` | BALANCE_SHEET / INCOME_STATEMENT with `subType`, `interval`, `mode`, `version` |
| `ReportEntries` | Hierarchical report rows (category → subCategory → lineItem) |
| `OnChainAnchors` | Bridge to chain: `buildId`, `unsignedCbor`, `signedCbor`, `txHash`, `slot`, status |

Schema: [`db/schema.cds`](../db/schema.cds).

## Status FSM

- **Transactions / Reports:** `DRAFT` → `VALIDATED` → `PUBLISHED` → `CONFIRMED`
- **OnChainAnchors:** `PENDING` → `SUBMITTED` → `CONFIRMED` (or `FAILED`)

## Reeve label-1447 format

FINCA serialises data in the official Reeve format (Cardano Foundation, CIP-10 reserved label `1447`). Example Individual Transactions:

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
              "counterparty": { "cust_code": "REAL-ESTATE-CORP", "type": "VENDOR" }
            }
          }
        ]
      }
    ]
  }
}
```

Spec: <https://docs.reeve.technology/metadataFormat>.

### On-chain reference TXs (Cardano Foundation 2024 financials)
- Balance Sheet: `5304b6bfd421005d1ce48507462d84e163d2c7d0a291345ffe15406bb52b5702`
- Income Statement: `6cf9c9dbbc208b0cd7af08efa8ed59efffb5f20a05da5519db3efc6dae9209dc`

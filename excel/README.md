# Excel Integration

Three ways to consume the FINCA OData feed from Excel, ordered by ease of use.

## 1. One-click `.odc` (Desktop Excel, Windows)

Double-click [`finca.odc`](finca.odc). Excel opens, asks for confirmation, and lets you pick which entity (`Organisations`, `Transactions`, `OnChainAnchors`, …) to load as a sheet table.

The feed URL inside is `http://localhost:4004/odata/v4/finance/`. Edit the file in any text editor if your service runs elsewhere.

## 2. Power Query M template (Desktop + Excel for the Web)

Open [`finca-power-query.m`](finca-power-query.m), copy the snippet, then in Excel:

1. **Data → Get Data → From Other Sources → Blank Query**
2. **View → Advanced Editor**
3. Paste, **Done**, **Close & Load**

This template loads `Transactions` with expanded `items` and casts `amount` to `Currency.Type` so `Decimal(23,2)` precision is preserved.

To switch entities, change `Name = "Transactions"` to any of:
`Organisations` · `AccountingPeriods` · `Transactions` · `TransactionItems` · `FinancialReports` · `ReportEntries` · `OnChainAnchors`

## 3. Native UI (any Excel)

**Data → Get Data → From Other Sources → From OData Feed**, paste:
```
http://localhost:4004/odata/v4/finance/
```

Excel's Navigator lists every entity. Pick one or many. Use the filter / expand UI to refine before loading.

## Refreshing

`Data → Refresh All` (or Ctrl+Alt+F5) re-fetches from the live feed. Schedule auto-refresh via **Query → Properties → Refresh every N minutes**.

## Caveats

| Issue | Workaround |
|---|---|
| `amount` rendered with float drift | Cast to `Currency.Type` in Power Query (template #2 does this). |
| Cannot call POST actions (`PublishTransactions`, `SubmitSigned`, …) from Excel | Use the SAPUI5 frontend, Office Scripts, Power Automate, or VBA `XMLHTTP`. |
| CORS blocks Excel for the Web | The dev server allows `*.officeapps.live.com` and `*.office.com` (see `srv/server.js`). For your own deployment, extend `ALLOWED_ORIGIN_PATTERNS`. |
| Auth | Excel supports Anonymous, Basic, Web API, OAuth 2.0. Match to CAP's `cds.requires.auth` setting. |

## What gets exposed

Every CDS entity in `FinanceService` is queryable with full OData V4 syntax:

```
GET /odata/v4/finance/Transactions?$filter=status eq 'CONFIRMED'&$expand=items($orderby=lineNumber)&$top=100
GET /odata/v4/finance/FinancialReports?$filter=year eq 2025 and subType eq 'BALANCE_SHEET'
GET /odata/v4/finance/OnChainAnchors?$filter=status eq 'CONFIRMED'&$select=txHash,slot,confirmedAt
```

Service `$metadata` document (full schema in EDMX format):
```
http://localhost:4004/odata/v4/finance/$metadata
```

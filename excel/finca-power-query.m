// FINCA OData V4 — Power Query M template
//
// Usage in Excel:
//   Data → Get Data → From Other Sources → Blank Query
//   View → Advanced Editor → paste this snippet → Done
//
// Edit the URL if the service runs on a different host/port.

let
    BaseUrl       = "http://localhost:4004/odata/v4/finance/",
    Source        = OData.Feed(BaseUrl, null, [Implementation = "2.0"]),

    // Pick an entity. Available:
    //   Organisations, AccountingPeriods, Transactions, TransactionItems,
    //   FinancialReports, ReportEntries, OnChainAnchors
    Transactions  = Source{[Name = "Transactions", Signature = "table"]}[Data],

    // Expand related items inline (debit/credit lines)
    Expanded      = Table.ExpandTableColumn(
                        Transactions,
                        "items",
                        {"lineNumber", "accountCode", "accountName", "amount", "currencyCode",
                         "costCenterCode", "vatCode", "vatRate", "counterpartyCode", "counterpartyType"},
                        {"items.lineNumber", "items.accountCode", "items.accountName", "items.amount",
                         "items.currencyCode", "items.costCenterCode", "items.vatCode", "items.vatRate",
                         "items.counterpartyCode", "items.counterpartyType"}
                    ),

    // Cast amount to Currency to preserve Decimal(23,2) precision
    Typed         = Table.TransformColumnTypes(Expanded, {{"items.amount", Currency.Type}})
in
    Typed

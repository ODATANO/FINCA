sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator"
], function (Controller, Filter, FilterOperator) {
  "use strict";

  return Controller.extend("finca.controller.Dashboard", {

    onInit: function () {
      var oComp = this.getOwnerComponent();
      oComp.getRouter().getRoute("dashboard").attachPatternMatched(this._onRouteMatched, this);
      oComp.getEventBus().subscribe("finca", "authChanged", this._loadStats, this);
    },

    onExit: function () {
      try {
        this.getOwnerComponent().getEventBus().unsubscribe("finca", "authChanged", this._loadStats, this);
      } catch (e) { /* ignore */ }
    },

    _onRouteMatched: function () {
      this._loadStats();
    },

    _loadStats: function () {
      var oModel = this.getView().getModel();
      var oAppModel = this.getOwnerComponent().getModel("app");
      if (!oModel || !oAppModel) return;

      Promise.all([
        this._count(oModel, "/Transactions"),
        this._count(oModel, "/FinancialReports"),
        this._count(oModel, "/OnChainAnchors", new Filter("status", FilterOperator.EQ, "CONFIRMED")),
        this._count(oModel, "/OnChainAnchors", new Filter("status", FilterOperator.EQ, "SUBMITTED")),
        this._count(oModel, "/AccountingPeriods")
      ]).then(function (aCounts) {
        oAppModel.setProperty("/stats", {
          transactionCount: aCounts[0],
          reportCount: aCounts[1],
          confirmedCount: aCounts[2],
          pendingCount: aCounts[3],
          periodCount: aCounts[4]
        });
      });
    },

    _count: function (oModel, sPath, oFilter) {
      // requestProperty("$count") on an unobserved list binding does not
      // reliably issue a request under autoExpandSelect. Force a fetch via
      // requestContexts, then read the count from the header context.
      return new Promise(function (resolve) {
        try {
          var oBinding = oModel.bindList(sPath, undefined, undefined, oFilter ? [oFilter] : undefined, { $count: true });
          var oHeader = oBinding.getHeaderContext();
          oBinding.requestContexts(0, 1).then(function () {
            var n = oHeader.getProperty("$count");
            resolve(typeof n === "number" ? n : Number(n) || 0);
          }).catch(function (err) {
            // eslint-disable-next-line no-console
            console.warn("[Dashboard] count failed for " + sPath, err);
            resolve(0);
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[Dashboard] _count exception for " + sPath, e);
          resolve(0);
        }
      });
    },

    onNavTransactions: function () {
      this.getOwnerComponent().getRouter().navTo("transactions");
    }
  });
});

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
      try {
        var oBinding = oModel.bindList(sPath, undefined, undefined, oFilter ? [oFilter] : undefined, { $count: true });
        return oBinding.getHeaderContext().requestProperty("$count")
          .then(function (n) { return n || 0; })
          .catch(function () { return 0; });
      } catch (e) {
        return Promise.resolve(0);
      }
    },

    onNavTransactions: function () {
      this.getOwnerComponent().getRouter().navTo("transactions");
    }
  });
});

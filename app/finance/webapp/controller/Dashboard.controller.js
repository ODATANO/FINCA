sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator"
], function (Controller, Filter, FilterOperator) {
  "use strict";

  return Controller.extend("finca.controller.Dashboard", {

    onInit: function () {
      this.getOwnerComponent().getRouter().getRoute("dashboard").attachPatternMatched(this._onRouteMatched, this);
    },

    _onRouteMatched: function () {
      this._loadStats();
    },

    _loadStats: function () {
      var oModel = this.getView().getModel();
      var oAppModel = this.getOwnerComponent().getModel("app");

      Promise.all([
        this._count(oModel, "/Transactions"),
        this._count(oModel, "/FinancialReports"),
        this._count(oModel, "/OnChainAnchors", new Filter("status", FilterOperator.EQ, "CONFIRMED")),
        this._count(oModel, "/OnChainAnchors", new Filter("status", FilterOperator.EQ, "SUBMITTED"))
      ]).then(function (aCounts) {
        oAppModel.setProperty("/stats", {
          transactionCount: aCounts[0],
          reportCount: aCounts[1],
          confirmedCount: aCounts[2],
          pendingCount: aCounts[3]
        });
      });
    },

    _count: function (oModel, sPath, oFilter) {
      var oBinding = oModel.bindList(sPath, undefined, undefined, oFilter ? [oFilter] : undefined, { $count: true });
      return oBinding.getHeaderContext().requestProperty("$count")
        .then(function (n) { return n || 0; })
        .catch(function () { return 0; });
    },

    onTxPress: function () {
      this.getOwnerComponent().getRouter().navTo("transactions");
    }
  });
});

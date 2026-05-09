sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
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

      // Load counts via OData $count
      var aPromises = [
        oModel.bindList("/Transactions").requestContexts(0, 0).then(function () { return 0; }),
        oModel.bindList("/FinancialReports").requestContexts(0, 0).then(function () { return 0; }),
        oModel.bindList("/OnChainAnchors", undefined, undefined, undefined).requestContexts(0, 0).then(function () { return 0; })
      ];

      // Simple approach: read small sets and count
      Promise.all([
        this._count(oModel, "/Transactions"),
        this._count(oModel, "/FinancialReports"),
        this._countFiltered(oModel, "/OnChainAnchors", "status", "CONFIRMED"),
        this._countFiltered(oModel, "/OnChainAnchors", "status", "SUBMITTED")
      ]).then(function (aCounts) {
        oAppModel.setProperty("/stats", {
          transactionCount: aCounts[0],
          reportCount: aCounts[1],
          confirmedCount: aCounts[2],
          pendingCount: aCounts[3]
        });
      });
    },

    _count: function (oModel, sPath) {
      return new Promise(function (resolve) {
        var oBinding = oModel.bindList(sPath);
        oBinding.requestContexts(0, 9999).then(function (aCtx) {
          resolve(aCtx.length);
        }).catch(function () { resolve(0); });
      });
    },

    _countFiltered: function (oModel, sPath, sField, sValue) {
      return new Promise(function (resolve) {
        var oFilter = new sap.ui.model.Filter(sField, "EQ", sValue);
        var oBinding = oModel.bindList(sPath, undefined, undefined, [oFilter]);
        oBinding.requestContexts(0, 9999).then(function (aCtx) {
          resolve(aCtx.length);
        }).catch(function () { resolve(0); });
      });
    },

    onTxPress: function (oEvent) {
      this.getOwnerComponent().getRouter().navTo("transactions");
    }
  });
});

sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "finca/model/CardanoWallet"
], function (Controller, MessageToast, MessageBox, Filter, FilterOperator, CardanoWallet) {
  "use strict";

  return Controller.extend("finca.controller.Reports", {

    onInit: function () {
      var oWalletModel = this.getOwnerComponent().getModel("wallet");
      oWalletModel.attachPropertyChange(this._onWalletChanged.bind(this));
    },

    _onWalletChanged: function () {
      var oWalletModel = this.getOwnerComponent().getModel("wallet");
      var sOrgId = oWalletModel.getProperty("/orgId");
      if (sOrgId) {
        var oTable = this.byId("reportTable");
        if (oTable) {
          var oBinding = oTable.getBinding("items");
          if (oBinding) {
            oBinding.filter(new Filter("org_ID", FilterOperator.EQ, sOrgId));
          }
        }
      }
    },

    onPublishReport: function () {
      var oTable = this.byId("reportTable");
      var oSelectedItem = oTable.getSelectedItem();
      if (!oSelectedItem) {
        MessageToast.show("Select a report to publish");
        return;
      }

      if (!CardanoWallet.isConnected()) {
        MessageBox.warning("Please connect your Cardano wallet first.");
        return;
      }

      var oCtx = oSelectedItem.getBindingContext();
      var sReportId = oCtx.getProperty("ID");
      var sSubType = oCtx.getProperty("subType") === "BALANCE_SHEET" ? "Balance Sheet" : "Income Statement";
      var iYear = oCtx.getProperty("year");

      MessageBox.confirm("Publish " + sSubType + " " + iYear + " on-chain (Label 1447)?", {
        onClose: function (sAction) {
          if (sAction === MessageBox.Action.OK) {
            this._publishAndSign(sReportId);
          }
        }.bind(this)
      });
    },

    _publishAndSign: function (sReportId) {
      var oModel = this.getView().getModel();

      MessageToast.show("Building metadata transaction...");
      var oBuild = oModel.bindContext("/PublishReport(...)");
      oBuild.setParameter("reportId", sReportId);

      oBuild.execute().then(function () {
        var oResult = oBuild.getBoundContext().getObject();
        MessageToast.show("Signing with wallet...");

        return CardanoWallet.signTx(oResult.unsignedCbor).then(function (sSignedCbor) {
          return { buildId: oResult.buildId, signedCbor: sSignedCbor };
        });
      }).then(function (oSigned) {
        MessageToast.show("Submitting to blockchain...");

        var oSubmit = oModel.bindContext("/SubmitSigned(...)");
        oSubmit.setParameter("buildId", oSigned.buildId);
        oSubmit.setParameter("signedTxCbor", oSigned.signedCbor);
        return oSubmit.execute().then(function () {
          return oSubmit.getBoundContext().getObject();
        });
      }).then(function (oSubmitResult) {
        MessageBox.success(
          "Report published!\n\nTX Hash: " + (oSubmitResult.txHash || "").substring(0, 32) + "..."
        );
        this.byId("reportTable").getBinding("items").refresh();
      }.bind(this)).catch(function (err) {
        if (err.message && err.message.indexOf("User") >= 0) {
          MessageToast.show("Signing cancelled by user");
        } else {
          MessageBox.error("Publish failed: " + (err.message || err));
        }
      });
    }
  });
});

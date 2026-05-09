sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "finca/model/CardanoWallet"
], function (Controller, MessageToast, MessageBox, CardanoWallet) {
  "use strict";

  return Controller.extend("finca.controller.Anchors", {

    onInit: function () {},

    onCheckPending: function () {
      var oModel = this.getView().getModel();
      var oAction = oModel.bindContext("/CheckPendingAnchors(...)");

      MessageToast.show("Checking pending anchors...");

      oAction.execute().then(function () {
        var oResult = oAction.getBoundContext().getObject();
        if (oResult.updated > 0) {
          MessageBox.success(oResult.updated + " anchor(s) confirmed on-chain!");
        } else {
          MessageToast.show("No new confirmations");
        }
        this.byId("anchorTable").getBinding("items").refresh();
      }.bind(this)).catch(function (err) {
        MessageBox.error("Check failed: " + (err.message || err));
      });
    },

    onRetry: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      var sAnchorId = oCtx.getProperty("ID");

      if (!CardanoWallet.isConnected()) {
        MessageBox.warning("Please connect your Cardano wallet to retry.");
        return;
      }

      var oModel = this.getView().getModel();
      var oAction = oModel.bindContext("/RetryFailed(...)");
      oAction.setParameter("anchorId", sAnchorId);

      MessageToast.show("Rebuilding transaction...");

      oAction.execute().then(function () {
        var oResult = oAction.getBoundContext().getObject();
        return CardanoWallet.signTx(oResult.unsignedCbor).then(function (sSignedCbor) {
          return { buildId: oResult.buildId, signedCbor: sSignedCbor };
        });
      }).then(function (oSigned) {
        var oSubmit = oModel.bindContext("/SubmitSigned(...)");
        oSubmit.setParameter("buildId", oSigned.buildId);
        oSubmit.setParameter("signedTxCbor", oSigned.signedCbor);
        return oSubmit.execute().then(function () {
          return oSubmit.getBoundContext().getObject();
        });
      }).then(function (oSubmitResult) {
        MessageBox.success("Retry submitted! TX Hash: " + (oSubmitResult.txHash || "").substring(0, 32) + "...");
        this.byId("anchorTable").getBinding("items").refresh();
      }.bind(this)).catch(function (err) {
        MessageBox.error("Retry failed: " + (err.message || err));
      });
    },

    onViewTx: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      var sTxHash = oCtx.getProperty("txHash");
      if (sTxHash) {
        window.open("https://preview.cardanoscan.io/transaction/" + sTxHash, "_blank");
      }
    }
  });
});

sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, MessageToast, MessageBox) {
  "use strict";

  return Controller.extend("finca.controller.Verify", {

    onInit: function () {},

    onVerifyTx: function () {
      var sTxHash = this.byId("verifyTxHashInput").getValue().trim();
      if (!sTxHash) {
        MessageToast.show("Enter a TX hash");
        return;
      }

      var oModel = this.getView().getModel();
      var oAppModel = this.getOwnerComponent().getModel("app");
      var oFunction = oModel.bindContext("/VerifyTransaction(...)");
      oFunction.setParameter("txHash", sTxHash);

      MessageToast.show("Verifying on-chain data...");

      oFunction.execute().then(function () {
        var oResult = oFunction.getBoundContext().getObject();

        // Pretty-print the on-chain data
        var sData = oResult.onChainData;
        try { sData = JSON.stringify(JSON.parse(sData), null, 2); } catch (e) { /* keep as-is */ }

        oAppModel.setProperty("/verify", {
          hasResult: true,
          verified: oResult.verified,
          localMatch: oResult.localMatch,
          onChainData: sData
        });
      }).catch(function (err) {
        MessageBox.error("Verification failed: " + (err.message || err));
      });
    },

    onVerifyReport: function () {
      var sReportId = this.byId("verifyReportInput").getValue().trim();
      if (!sReportId) {
        MessageToast.show("Enter a Report ID");
        return;
      }

      var oModel = this.getView().getModel();
      var oAppModel = this.getOwnerComponent().getModel("app");
      var oFunction = oModel.bindContext("/VerifyReport(...)");
      oFunction.setParameter("reportId", sReportId);

      MessageToast.show("Verifying report...");

      oFunction.execute().then(function () {
        var oResult = oFunction.getBoundContext().getObject();

        var sData = oResult.onChainData;
        try { sData = JSON.stringify(JSON.parse(sData), null, 2); } catch (e) { /* keep as-is */ }

        oAppModel.setProperty("/verify", {
          hasResult: true,
          verified: oResult.verified,
          localMatch: oResult.localMatch,
          onChainData: sData
        });
      }).catch(function (err) {
        MessageBox.error("Verification failed: " + (err.message || err));
      });
    }
  });
});

sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "finca/model/CardanoWallet"
], function (Controller, MessageToast, MessageBox, Filter, FilterOperator, CardanoWallet) {
  "use strict";

  return Controller.extend("finca.controller.Transactions", {

    onInit: function () {
      // Listen for wallet model changes to filter by org
      var oWalletModel = this.getOwnerComponent().getModel("wallet");
      oWalletModel.attachPropertyChange(this._onWalletChanged.bind(this));
    },

    _onWalletChanged: function () {
      var oWalletModel = this.getOwnerComponent().getModel("wallet");
      var bConnected = oWalletModel.getProperty("/connected");
      var sBech32 = oWalletModel.getProperty("/bech32");

      if (bConnected && sBech32) {
        this._filterByWallet(sBech32);
      }
    },

    /**
     * Find the org whose walletAddress matches the connected wallet,
     * then filter all transaction tables to that org.
     */
    _filterByWallet: function (sBech32) {
      var oModel = this.getView().getModel();
      var oOrgBinding = oModel.bindList("/Organisations", undefined, undefined, [
        new Filter("walletAddress", FilterOperator.EQ, sBech32)
      ]);
      oOrgBinding.requestContexts(0, 1).then(function (aCtx) {
        if (aCtx.length > 0) {
          var sOrgId = aCtx[0].getProperty("ID");
          var oWalletModel = this.getOwnerComponent().getModel("wallet");
          oWalletModel.setProperty("/orgId", sOrgId);
          this._applyOrgFilter(sOrgId);
        }
      }.bind(this)).catch(function () { /* no matching org — show all */ });
    },

    _applyOrgFilter: function (sOrgId) {
      var oFilter = new Filter("org_ID", FilterOperator.EQ, sOrgId);
      ["txTableAll", "txTableDraft", "txTableOnChain"].forEach(function (sId) {
        var oTable = this.byId(sId);
        if (oTable) {
          var oBinding = oTable.getBinding("items");
          if (oBinding) {
            // Merge with existing filters (status filters from XML)
            oBinding.filter(oFilter);
          }
        }
      }.bind(this));
    },

    /**
     * Get batch ID from selected table rows or from the manual input field.
     * If rows are selected, uses the batchId of the first selected row.
     */
    _getBatchId: function () {
      // 1. Try selected table rows
      var oTable = this.byId("txTableAll");
      var aSelected = oTable.getSelectedItems();
      if (aSelected.length > 0) {
        var sBatchId = aSelected[0].getBindingContext().getProperty("batchId");
        if (sBatchId) return sBatchId;
      }
      // 2. Fallback: manual input
      return this.byId("batchInput").getValue().trim();
    },

    onSearchTx: function (oEvent) {
      var sQuery = oEvent.getParameter("newValue");
      var aFilters = [];
      if (sQuery) {
        aFilters.push(new Filter({
          filters: [
            new Filter("transactionNumber", FilterOperator.Contains, sQuery),
            new Filter("batchId", FilterOperator.Contains, sQuery),
            new Filter("type", FilterOperator.Contains, sQuery)
          ],
          and: false
        }));
      }
      this.byId("txTableAll").getBinding("items").filter(aFilters);
    },

    // ── Validate Batch ─────────────────────────────────────────

    onValidateBatch: function () {
      var sBatchId = this._getBatchId();
      if (!sBatchId) {
        MessageToast.show("Select transactions or enter a Batch ID");
        return;
      }

      var oModel = this.getView().getModel();
      var oAction = oModel.bindContext("/ValidateBatch(...)");
      oAction.setParameter("batchId", sBatchId);

      oAction.execute().then(function () {
        var oResult = oAction.getBoundContext().getObject();
        if (oResult.valid) {
          MessageBox.success("Batch '" + sBatchId + "' is valid and ready to publish.");
        } else {
          MessageBox.warning("Validation errors:\n\n" + (oResult.errors || []).join("\n"));
        }
        this.byId("txTableAll").getBinding("items").refresh();
      }.bind(this)).catch(function (err) {
        MessageBox.error("Validation failed: " + (err.message || err));
      });
    },

    // ── Publish Batch (Build → Sign → Submit) ──────────────────

    onPublishBatch: function () {
      var sBatchId = this._getBatchId();
      if (!sBatchId) {
        MessageToast.show("Select transactions or enter a Batch ID");
        return;
      }

      if (!CardanoWallet.isConnected()) {
        MessageBox.warning("Please connect your Cardano wallet first.");
        return;
      }

      MessageBox.confirm("Publish batch '" + sBatchId + "' on-chain (Label 1447)?", {
        onClose: function (sAction) {
          if (sAction === MessageBox.Action.OK) {
            this._publishAndSign(sBatchId);
          }
        }.bind(this)
      });
    },

    _publishAndSign: function (sBatchId) {
      var oModel = this.getView().getModel();

      // Step 1: Build unsigned TX
      MessageToast.show("Building metadata transaction...");
      var oBuild = oModel.bindContext("/PublishTransactions(...)");
      oBuild.setParameter("batchId", sBatchId);
      oBuild.setParameter("walletAddress", CardanoWallet.getAddress());

      oBuild.execute().then(function () {
        var oResult = oBuild.getBoundContext().getObject();
        MessageToast.show("Signing with wallet...");

        // Step 2: Sign with CIP-30 wallet
        return CardanoWallet.signTx(oResult.unsignedCbor).then(function (sSignedCbor) {
          return { buildId: oResult.buildId, signedCbor: sSignedCbor };
        });
      }).then(function (oSigned) {
        MessageToast.show("Submitting to blockchain...");

        // Step 3: Submit signed TX
        var oSubmit = oModel.bindContext("/SubmitSigned(...)");
        oSubmit.setParameter("buildId", oSigned.buildId);
        oSubmit.setParameter("signedTxCbor", oSigned.signedCbor);
        return oSubmit.execute().then(function () {
          return oSubmit.getBoundContext().getObject();
        });
      }).then(function (oSubmitResult) {
        MessageBox.success(
          "Transaction submitted!\n\nTX Hash: " + (oSubmitResult.txHash || "").substring(0, 32) + "...\n\n" +
          "Status will update automatically when confirmed on-chain."
        );
        this.byId("txTableAll").getBinding("items").refresh();
      }.bind(this)).catch(function (err) {
        if (err.message && err.message.indexOf("User") >= 0) {
          MessageToast.show("Signing cancelled by user");
        } else {
          MessageBox.error("Transaction failed: " + (err.message || err));
        }
      });
    }
  });
});

sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/core/Fragment",
  "sap/ui/model/json/JSONModel",
  "finca/model/CardanoWallet"
], function (Controller, MessageToast, MessageBox, Filter, FilterOperator, Fragment, JSONModel, CardanoWallet) {
  "use strict";

  return Controller.extend("finca.controller.Reports", {

    onInit: function () {
      this.getView().setModel(new JSONModel({ mode: "create", canEdit: true }), "dialog");
      this.getView().setModel(new JSONModel({ orgs: [], periods: [] }), "org");
      this._loadOrgs();

      var oWalletModel = this.getOwnerComponent().getModel("wallet");
      oWalletModel.attachPropertyChange(this._onWalletChanged.bind(this));
    },

    _loadOrgs: function () {
      var oModel = this.getOwnerComponent().getModel();
      oModel.bindList("/Organisations").requestContexts(0, 100).then(function (a) {
        this.getView().getModel("org").setProperty("/orgs",
          a.map(function (c) { return c.getObject(); }));
      }.bind(this));
      oModel.bindList("/AccountingPeriods").requestContexts(0, 200).then(function (a) {
        this.getView().getModel("org").setProperty("/periods",
          a.map(function (c) { return c.getObject(); }));
      }.bind(this));
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
    },

    // ── CRUD: Create / Edit Dialog ─────────────────────────────

    _loadDialog: function () {
      if (!this._pDialog) {
        this._pDialog = Fragment.load({
          id: this.getView().getId(),
          name: "finca.fragment.ReportDialog",
          controller: this
        }).then(function (oDialog) {
          this.getView().addDependent(oDialog);
          return oDialog;
        }.bind(this));
      }
      return this._pDialog;
    },

    _isOnChain: function (sStatus) {
      return sStatus === "PUBLISHED" || sStatus === "CONFIRMED";
    },

    onAddReport: function () {
      var oBinding = this.byId("reportTable").getBinding("items");
      var aOrgs = this.getView().getModel("org").getProperty("/orgs") || [];
      if (!aOrgs.length) {
        MessageBox.warning("Create an organisation first.");
        return;
      }
      var iYear = new Date().getFullYear();
      this._oCreateCtx = oBinding.create({
        org_ID: aOrgs[0].ID,
        subType: "BALANCE_SHEET",
        year: iYear,
        interval: "ANNUAL",
        mode: "ACTUAL",
        version: "1.0",
        status: "DRAFT"
      }, true);
      this.getView().getModel("dialog").setData({ mode: "create", canEdit: true });
      this._loadDialog().then(function (oDialog) {
        oDialog.setBindingContext(this._oCreateCtx);
        oDialog.open();
      }.bind(this));
    },

    onReportPress: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      if (!oCtx) return;
      this._oCreateCtx = null;
      var sStatus = oCtx.getProperty("status");
      this.getView().getModel("dialog").setData({
        mode: "edit",
        canEdit: !this._isOnChain(sStatus)
      });
      this._loadDialog().then(function (oDialog) {
        oDialog.setBindingContext(oCtx);
        oDialog.open();
      });
    },

    onReportConfirm: function () {
      var oModel = this.getView().getModel();
      var bCreate = this.getView().getModel("dialog").getProperty("/mode") === "create";
      oModel.submitBatch("$auto").then(function () {
        MessageToast.show(bCreate ? "Report created" : "Changes saved");
      }).catch(function (err) {
        MessageBox.error("Save failed: " + (err.message || err));
      });
      this._pDialog.then(function (d) { d.close(); });
    },

    onReportCancel: function () {
      var oModel = this.getView().getModel();
      if (this._oCreateCtx) {
        this._oCreateCtx.delete("$auto").catch(function () { /* ignore */ });
        this._oCreateCtx = null;
      } else {
        oModel.resetChanges("$auto");
      }
      this._pDialog.then(function (d) { d.close(); });
    },

    onAddEntry: function () {
      var oTable = this.byId("reportEntriesTable");
      var oBinding = oTable && oTable.getBinding("items");
      if (!oBinding) return;
      oBinding.create({
        category: "ASSETS",
        subCategory: "",
        lineItem: "",
        amount: "0.00",
        sortOrder: (oBinding.getLength() || 0) + 1
      }, true);
    },

    onRemoveEntry: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      if (!oCtx) return;
      oCtx.delete("$auto").catch(function (err) {
        MessageBox.error("Delete failed: " + (err.message || err));
      });
    }
  });
});

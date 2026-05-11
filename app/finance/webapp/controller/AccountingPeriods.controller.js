sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "sap/ui/core/Fragment",
  "sap/ui/model/json/JSONModel"
], function (Controller, MessageToast, MessageBox, Fragment, JSONModel) {
  "use strict";

  return Controller.extend("finca.controller.AccountingPeriods", {

    onInit: function () {
      this.getView().setModel(new JSONModel({ mode: "create" }), "dialog");
      this.getView().setModel(new JSONModel({ orgs: [] }), "org");
      this._loadOrgs();
    },

    _loadOrgs: function () {
      var oModel = this.getOwnerComponent().getModel();
      var oBinding = oModel.bindList("/Organisations");
      oBinding.requestContexts(0, 100).then(function (aCtx) {
        var aOrgs = aCtx.map(function (c) { return c.getObject(); });
        this.getView().getModel("org").setProperty("/orgs", aOrgs);
      }.bind(this));
    },

    _loadDialog: function () {
      if (!this._pDialog) {
        this._pDialog = Fragment.load({
          id: this.getView().getId(),
          name: "finca.fragment.AccountingPeriodDialog",
          controller: this
        }).then(function (oDialog) {
          this.getView().addDependent(oDialog);
          return oDialog;
        }.bind(this));
      }
      return this._pDialog;
    },

    onAddPeriod: function () {
      var oBinding = this.byId("periodTable").getBinding("items");
      var aOrgs = this.getView().getModel("org").getProperty("/orgs") || [];
      if (!aOrgs.length) {
        MessageBox.warning("No organisation available — create one first.");
        return;
      }
      var sNow = new Date().toISOString().slice(0, 10);
      var iYear = new Date().getFullYear();
      this._oCreateCtx = oBinding.create({
        org_ID: aOrgs[0].ID,
        period: iYear + "-01",
        year: iYear,
        startDate: sNow,
        endDate: sNow,
        status: "OPEN"
      }, true);
      this.getView().getModel("dialog").setProperty("/mode", "create");
      this._loadDialog().then(function (oDialog) {
        oDialog.setBindingContext(this._oCreateCtx);
        oDialog.open();
      }.bind(this));
    },

    onPeriodPress: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      if (!oCtx) return;
      this._oCreateCtx = null;
      this.getView().getModel("dialog").setProperty("/mode", "edit");
      this._loadDialog().then(function (oDialog) {
        oDialog.setBindingContext(oCtx);
        oDialog.open();
      });
    },

    onPeriodConfirm: function () {
      var oModel = this.getOwnerComponent().getModel();
      var bCreate = this.getView().getModel("dialog").getProperty("/mode") === "create";
      oModel.submitBatch("$auto").then(function () {
        MessageToast.show(bCreate ? "Period created" : "Changes saved");
      }).catch(function (err) {
        MessageBox.error("Save failed: " + (err.message || err));
      });
      this._pDialog.then(function (d) { d.close(); });
    },

    onPeriodCancel: function () {
      var oModel = this.getOwnerComponent().getModel();
      if (this._oCreateCtx) {
        this._oCreateCtx.delete("$auto").catch(function () { /* ignore */ });
        this._oCreateCtx = null;
      } else {
        oModel.resetChanges("$auto");
      }
      this._pDialog.then(function (d) { d.close(); });
    }
  });
});

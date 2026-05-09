sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "sap/ui/core/Fragment",
  "finca/model/CardanoWallet"
], function (Controller, MessageToast, MessageBox, Fragment, CardanoWallet) {
  "use strict";

  return Controller.extend("finca.controller.Organisations", {

    onInit: function () {},

    onAddOrg: function () {
      if (!this._pAddDialog) {
        this._pAddDialog = Fragment.load({
          id: this.getView().getId(),
          name: "finca.fragment.AddOrgDialog",
          controller: this
        }).then(function (oDialog) {
          this.getView().addDependent(oDialog);
          return oDialog;
        }.bind(this));
      }

      this._pAddDialog.then(function (oDialog) {
        // Pre-fill wallet address if connected
        if (CardanoWallet.isConnected()) {
          sap.ui.getCore().byId(this.getView().getId() + "--orgWalletInput").setValue(CardanoWallet.getAddress());
        }
        oDialog.open();
      }.bind(this));
    },

    onAddOrgConfirm: function () {
      var oView = this.getView();
      var sName = oView.byId("orgNameInput").getValue();
      var sCurrency = oView.byId("orgCurrencyInput").getValue() || "EUR";
      var sCountry = oView.byId("orgCountryInput").getValue() || "DE";
      var sTaxId = oView.byId("orgTaxIdInput").getValue();
      var sWallet = oView.byId("orgWalletInput").getValue();

      if (!sName) {
        MessageToast.show("Name is required");
        return;
      }

      var oListBinding = this.byId("orgTable").getBinding("items");
      var oContext = oListBinding.create({
        name: sName,
        currencyCode: sCurrency,
        countryCode: sCountry,
        taxIdNumber: sTaxId,
        walletAddress: sWallet
      });

      oContext.created().then(function () {
        MessageToast.show("Organisation created");
      }).catch(function (err) {
        MessageBox.error("Create failed: " + (err.message || err));
      });

      this._pAddDialog.then(function (d) { d.close(); });
    },

    onAddOrgCancel: function () {
      this._pAddDialog.then(function (d) { d.close(); });
    }
  });
});

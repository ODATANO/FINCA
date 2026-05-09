sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "finca/model/CardanoWallet"
], function (Controller, MessageToast, MessageBox, CardanoWallet) {
  "use strict";

  return Controller.extend("finca.controller.App", {

    onInit: function () {
      // Detect wallets
      var oWalletModel = this.getOwnerComponent().getModel("wallet");
      var aWallets = CardanoWallet.detect();
      oWalletModel.setProperty("/wallets", aWallets);
    },

    // ── Welcome Screen ─────────────────────────────────────────

    onWelcomeWalletSelect: function (oEvent) {
      var oItem = oEvent.getParameter("listItem");
      var oCtx = oItem.getBindingContext("wallet");
      var sWalletId = oCtx.getProperty("id");

      var oWalletModel = this.getOwnerComponent().getModel("wallet");
      oWalletModel.setProperty("/connecting", true);

      CardanoWallet.connect(sWalletId).then(function (oResult) {
        oWalletModel.setProperty("/connected", true);
        oWalletModel.setProperty("/connecting", false);
        oWalletModel.setProperty("/name", oResult.name);
        oWalletModel.setProperty("/bech32", oResult.bech32);
        oWalletModel.setProperty("/vkh", oResult.vkh);
        oWalletModel.setProperty("/address", oResult.address);

        MessageToast.show("Connected to " + oResult.name);
        this._navToApp();
      }.bind(this)).catch(function (err) {
        oWalletModel.setProperty("/connecting", false);
        oWalletModel.setProperty("/error", err.message || "Connection failed");
        MessageBox.error("Wallet connection failed: " + (err.message || err));
      });
    },

    onSkipWallet: function () {
      this._navToApp();
    },

    // ── Navigation ─────────────────────────────────────────────

    onNavSelect: function (oEvent) {
      var sKey = oEvent.getParameter("item").getKey();
      this.getOwnerComponent().getRouter().navTo(sKey);
    },

    onToggleMenu: function () {
      var oToolPage = this.byId("toolPage");
      oToolPage.setSideExpanded(!oToolPage.getSideExpanded());
    },

    // ── Wallet Button (header) ─────────────────────────────────

    onWalletPress: function () {
      var oWalletModel = this.getOwnerComponent().getModel("wallet");

      if (CardanoWallet.isConnected()) {
        MessageBox.confirm("Disconnect wallet '" + CardanoWallet.getName() + "'?", {
          onClose: function (sAction) {
            if (sAction === MessageBox.Action.OK) {
              CardanoWallet.disconnect();
              oWalletModel.setProperty("/connected", false);
              oWalletModel.setProperty("/name", "");
              oWalletModel.setProperty("/bech32", "");
              oWalletModel.setProperty("/vkh", "");
              MessageToast.show("Wallet disconnected");
              this._navToWelcome();
            }
          }.bind(this)
        });
      } else {
        this._navToWelcome();
      }
    },

    // ── Helpers ─────────────────────────────────────────────────

    _navToApp: function () {
      this.byId("rootApp").to(this.byId("toolPage"));
    },

    _navToWelcome: function () {
      this.byId("rootApp").to(this.byId("welcomePage"));
    }
  });
});

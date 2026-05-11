sap.ui.define([
  "sap/ui/core/UIComponent",
  "finca/model/CardanoWallet"
], function (UIComponent, CardanoWallet) {
  "use strict";
  return UIComponent.extend("finca.Component", {
    metadata: { manifest: "json" },
    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      // Restore JWT from sessionStorage on reload so the OData model
      // can authenticate before any view binds against it.
      this.applyAuth();

      this.getRouter().initialize();
    },

    /**
     * Push the current JWT into the OData model's HTTP headers.
     * Call after sign-in and after disconnect.
     */
    applyAuth: function () {
      var oModel = this.getModel();
      if (!oModel || typeof oModel.changeHttpHeaders !== "function") return;

      // Try to revive a cached session JWT for the previously connected wallet
      if (!CardanoWallet.isSignedIn()) {
        try {
          var raw = window.sessionStorage.getItem("finca.jwt");
          if (raw) {
            var cached = JSON.parse(raw);
            if (cached && cached.expiresAt > Date.now()) {
              oModel.changeHttpHeaders({ Authorization: "Bearer " + cached.jwt });
              return;
            }
          }
        } catch (e) { /* ignore */ }
        oModel.changeHttpHeaders({ Authorization: undefined });
        return;
      }

      oModel.changeHttpHeaders({ Authorization: "Bearer " + CardanoWallet.getJwt() });
    },

    /**
     * Idempotent onboarding: creates an org for the signed-in wallet if
     * none exists. Server-side handler returns the existing one otherwise.
     */
    provisionOrg: function () {
      var oModel = this.getModel();
      if (!oModel) return Promise.resolve(null);
      var oCtx = oModel.bindContext("/ProvisionOrg(...)");
      return oCtx.execute().then(function () {
        var oResult = oCtx.getBoundContext().getObject();
        var oApp = this.getModel("app");
        if (oApp) {
          oApp.setProperty("/orgId", oResult.ID);
          oApp.setProperty("/orgName", oResult.name);
          oApp.setProperty("/orgWallet", oResult.walletAddress);
        }
        return oResult;
      }.bind(this));
    }
  });
});

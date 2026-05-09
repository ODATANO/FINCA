/**
 * CIP-30 Cardano Wallet Adapter — reused from ODATANO/TRACE.
 *
 * Self-contained module for browser wallet integration (Nami, Eternl, Lace, etc.).
 * Handles detection, connection, signing, bech32 encoding, and VKH extraction.
 */
sap.ui.define([], function () {
  "use strict";

  var _api = null;
  var _name = "";
  var _addressHex = "";
  var _addressBech32 = "";
  var _vkh = "";

  var KNOWN_WALLETS = ["nami", "eternl", "lace", "flint", "typhon", "gerowallet", "nufi", "begin", "vespr"];

  // ── Bech32 encoding (minimal, standards-compliant) ─────────────────────

  var BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

  function _polymod(values) {
    var GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    var chk = 1;
    for (var i = 0; i < values.length; i++) {
      var b = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ values[i];
      for (var j = 0; j < 5; j++) {
        if ((b >> j) & 1) { chk ^= GEN[j]; }
      }
    }
    return chk;
  }

  function _hrpExpand(hrp) {
    var ret = [];
    for (var i = 0; i < hrp.length; i++) { ret.push(hrp.charCodeAt(i) >> 5); }
    ret.push(0);
    for (var i = 0; i < hrp.length; i++) { ret.push(hrp.charCodeAt(i) & 31); }
    return ret;
  }

  function _createChecksum(hrp, data) {
    var values = _hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
    var polymod = _polymod(values) ^ 1;
    var ret = [];
    for (var i = 0; i < 6; i++) { ret.push((polymod >> (5 * (5 - i))) & 31); }
    return ret;
  }

  function _convertBits(data, fromBits, toBits, pad) {
    var acc = 0, bits = 0, ret = [];
    var maxv = (1 << toBits) - 1;
    for (var i = 0; i < data.length; i++) {
      acc = (acc << fromBits) | data[i];
      bits += fromBits;
      while (bits >= toBits) {
        bits -= toBits;
        ret.push((acc >> bits) & maxv);
      }
    }
    if (pad) {
      if (bits > 0) { ret.push((acc << (toBits - bits)) & maxv); }
    }
    return ret;
  }

  function _hexToBytes(hex) {
    var bytes = [];
    for (var i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return bytes;
  }

  /**
   * Strip CBOR byte-string wrapper from CIP-30 address hex.
   * Some wallets (Eternl, Lace) return cbor<address>, Nami returns raw hex.
   */
  function _stripCborByteString(hex) {
    var b0 = parseInt(hex.substr(0, 2), 16);
    if ((b0 & 0xe0) === 0x40) {
      var addInfo = b0 & 0x1f;
      if (addInfo <= 23) return hex.substr(2);
      if (addInfo === 24) return hex.substr(4);
      if (addInfo === 25) return hex.substr(6);
    }
    return hex;
  }

  function _hexToBech32(hexAddr) {
    var rawHex = _stripCborByteString(hexAddr);
    var bytes = _hexToBytes(rawHex);
    var network = bytes[0] & 0x0F;
    var hrp = network === 0 ? "addr_test" : "addr";
    var data5bit = _convertBits(bytes, 8, 5, true);
    var checksum = _createChecksum(hrp, data5bit);
    var encoded = hrp + "1";
    for (var i = 0; i < data5bit.length; i++) encoded += BECH32_CHARSET[data5bit[i]];
    for (var i = 0; i < checksum.length; i++) encoded += BECH32_CHARSET[checksum[i]];
    return encoded;
  }

  // ── Bech32 decoding ────────────────────────────────────────────────────

  function _bech32Decode(str) {
    var pos = str.lastIndexOf("1");
    var hrp = str.substring(0, pos);
    var dataStr = str.substring(pos + 1);
    var data = [];
    for (var i = 0; i < dataStr.length; i++) {
      var idx = BECH32_CHARSET.indexOf(dataStr[i]);
      if (idx === -1) return null;
      data.push(idx);
    }
    // Strip checksum (last 6)
    return { hrp: hrp, data: data.slice(0, data.length - 6) };
  }

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    /**
     * Detect installed CIP-30 wallets.
     * @returns {Array<{id: string, name: string, icon: string}>}
     */
    detect: function () {
      var wallets = [];
      if (typeof window === "undefined" || !window.cardano) return wallets;

      KNOWN_WALLETS.forEach(function (id) {
        var w = window.cardano[id];
        if (w && typeof w.enable === "function") {
          wallets.push({
            id: id,
            name: w.name || id,
            icon: w.icon || ""
          });
        }
      });
      return wallets;
    },

    /**
     * Connect to a CIP-30 wallet.
     * @param {string} sWalletId — wallet identifier (e.g. "nami", "eternl")
     * @returns {Promise<{name, address, bech32, vkh}>}
     */
    connect: function (sWalletId) {
      var oWallet = window.cardano && window.cardano[sWalletId];
      if (!oWallet) return Promise.reject(new Error("Wallet '" + sWalletId + "' not found"));

      _name = oWallet.name || sWalletId;

      return oWallet.enable().then(function (api) {
        _api = api;
        return api.getUsedAddresses();
      }).then(function (aAddresses) {
        if (!aAddresses || aAddresses.length === 0) {
          return _api.getChangeAddress().then(function (addr) { return [addr]; });
        }
        return aAddresses;
      }).then(function (aAddresses) {
        var sRawHex = _stripCborByteString(aAddresses[0]);
        _addressHex = sRawHex;
        _addressBech32 = _hexToBech32(aAddresses[0]);
        _vkh = sRawHex.slice(2, 58); // 28-byte payment key hash

        return { name: _name, address: _addressHex, bech32: _addressBech32, vkh: _vkh };
      });
    },

    disconnect: function () {
      _api = null;
      _name = "";
      _addressHex = "";
      _addressBech32 = "";
      _vkh = "";
    },

    isConnected: function () { return _api !== null; },
    getName: function () { return _name; },
    getAddress: function () { return _addressBech32; },
    getAddressHex: function () { return _addressHex; },
    getVkh: function () { return _vkh; },

    /**
     * Sign a transaction CBOR with the connected wallet.
     * @param {string} sTxCbor — unsigned transaction CBOR hex
     * @param {boolean} [bPartialSign=true] — allow partial signing
     * @returns {Promise<string>} — signed transaction or witness set CBOR hex
     */
    signTx: function (sTxCbor, bPartialSign) {
      if (!_api) return Promise.reject(new Error("Wallet not connected"));
      return _api.signTx(sTxCbor, bPartialSign !== false);
    },

    /**
     * Extract VKH from a bech32 address.
     * @param {string} sBech32 — Cardano bech32 address
     * @returns {string} — 56-char hex VKH
     */
    bech32ToVkh: function (sBech32) {
      var decoded = _bech32Decode(sBech32);
      if (!decoded) return "";
      var bytes8 = _convertBits(decoded.data, 5, 8, false);
      // Skip header byte, take next 28 bytes
      var vkhBytes = bytes8.slice(1, 29);
      return vkhBytes.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    }
  };
});

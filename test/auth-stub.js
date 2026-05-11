/**
 * Test-only auth strategy. Maps every request to a fixed wallet identity
 * (`addr_test1xxx`) so existing tests run authenticated without minting JWTs.
 * Wired in via `cds.env.requires.auth.kind = './test/auth-stub'` in env.js.
 */
const cds = require('@sap/cds');

const TEST_WALLET = process.env.TEST_WALLET || 'addr_test1xxx';

module.exports = (req, _res, next) => {
  req.user = new cds.User({
    id: TEST_WALLET,
    roles: { 'authenticated-user': 1, 'wallet-user': 1 }
  });
  next();
};

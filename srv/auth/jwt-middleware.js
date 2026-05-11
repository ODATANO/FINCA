/**
 * Custom CAP auth strategy: verifies `Authorization: Bearer <jwt>` and binds
 * `req.user` to a CAP user whose `id` = wallet bech32 address.
 *
 * Registered via `cds.requires.auth.kind = './srv/auth/jwt-middleware'` in package.json.
 *
 * Routes without a token (or with an invalid one) fall through as the
 * anonymous user — CAP then 401s any endpoint with `@requires`.
 */
const cds = require('@sap/cds');

const LOG = cds.log('jwt-auth');
let _jwtVerify = null;
let _secret = null;

async function getJwtVerify() {
  if (!_jwtVerify) {
    const jose = await import('jose');
    _jwtVerify = jose.jwtVerify;
  }
  return _jwtVerify;
}

function getSecret() {
  if (_secret) return _secret;
  _secret = require('./jwt-secret').getJwtSecret();
  return _secret;
}

module.exports = async (req, res, next) => {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || !header.startsWith('Bearer ')) {
    // Anonymous — CAP's @requires will gate as needed
    req.user = new cds.User({ id: 'anonymous' });
    return next();
  }

  const token = header.slice(7).trim();
  try {
    const jwtVerify = await getJwtVerify();
    const { payload } = await jwtVerify(token, getSecret());
    const address = payload.sub || payload.addr;
    if (typeof address !== 'string') throw new Error('Token missing subject');
    req.user = new cds.User({
      id: address,
      roles: { 'authenticated-user': 1, 'wallet-user': 1 }
    });
  } catch (err) {
    LOG.debug('JWT verification failed:', err.message);
    req.user = new cds.User({ id: 'anonymous' });
  }
  next();
};

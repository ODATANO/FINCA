/**
 * AuthService — CIP-30 wallet sign-in flow.
 *
 *   POST /auth/Nonce    → fresh server-issued nonce (5 min TTL, one-time-use)
 *   POST /auth/Verify   → validates COSE_Sign1 over (nonce-bound payload), issues 24h JWT
 *
 * Wallet bech32 address is the identity. JWT `sub` = bech32 address.
 */
import cds, { ApplicationService, Request } from '@sap/cds';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { verifyCip30Signature } from './auth/cose-verify';
import { AuthNonces } from '#cds-models/finca';
import { getJwtSecret } from './auth/jwt-secret';

const LOG = cds.log('auth-service');
const NONCE_TTL_MS = 5 * 60 * 1000;          // 5 min
const JWT_TTL_SEC  = 24 * 60 * 60;           // 24 h

function signMessage(nonce: string): string {
  return `FINCA login: ${nonce}`;
}

class AuthService extends ApplicationService {
  async init() {
    this.on('Nonce', this._handleNonce.bind(this));
    this.on('Verify', this._handleVerify.bind(this));
    await super.init();
  }

  private async _handleNonce(req: Request) {
    const { address } = req.data;
    if (!address || typeof address !== 'string') {
      return req.reject(400, 'address required');
    }

    const nonce = randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);

    await INSERT.into(AuthNonces).entries({
      nonce,
      address,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      consumedAt: null
    });

    return {
      nonce,
      payload: signMessage(nonce),
      expiresAt: expiresAt.toISOString()
    };
  }

  private async _handleVerify(req: Request) {
    const { address, nonce, signature, key } = req.data;
    if (!address || !nonce || !signature || !key) {
      return req.reject(400, 'address, nonce, signature, key required');
    }

    // 1. Load + atomically consume the nonce
    const row = await SELECT.one.from(AuthNonces).where({ nonce });
    if (!row) return req.reject(401, 'Unknown nonce');
    if (row.consumedAt) return req.reject(401, 'Nonce already used');
    if (row.address !== address) return req.reject(401, 'Nonce/address mismatch');
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      return req.reject(401, 'Nonce expired');
    }

    // 2. Verify COSE_Sign1
    const result = verifyCip30Signature(
      { signature, key },
      address,
      signMessage(nonce)
    );
    if (!result.valid) {
      LOG.warn(`Signature rejected for ${address}: ${result.reason}`);
      return req.reject(401, `Signature invalid: ${result.reason}`);
    }

    // 3. Burn nonce (one-time-use)
    await UPDATE(AuthNonces).where({ nonce }).set({ consumedAt: new Date().toISOString() });

    // 4. Issue JWT
    const expSec = Math.floor(Date.now() / 1000) + JWT_TTL_SEC;
    const jwt = await new SignJWT({ addr: address })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(address)
      .setIssuedAt()
      .setExpirationTime(expSec)
      .sign(getJwtSecret());

    LOG.info(`Sign-in success: ${address}`);
    return {
      jwt,
      expiresAt: new Date(expSec * 1000).toISOString(),
      address
    };
  }
}

export default AuthService;

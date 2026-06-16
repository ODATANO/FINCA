/**
 * AuthService integration tests — covers the nonce/verify endpoints and the
 * happy path of signature verification using a freshly generated Ed25519
 * key plus a manually-constructed COSE_Sign1 payload.
 */
import cds from '@sap/cds';
import * as crypto from 'node:crypto';
import {
  Cbor,
  CborArray,
  CborBytes,
  CborMap,
  CborNegInt,
  CborText,
  CborUInt
} from '@harmoniclabs/cbor';
import { Address, Credential } from '@harmoniclabs/cardano-ledger-ts';
import { blake2b_224 } from '@harmoniclabs/crypto';

const { POST } = (cds as any).test(__dirname + '/..');

/** Extract the raw 32-byte Ed25519 public key from a node KeyObject (strip SPKI DER prefix). */
function rawPublicKey(publicKey: crypto.KeyObject): Uint8Array {
  return Uint8Array.prototype.slice.call(
    publicKey.export({ format: 'der', type: 'spki' }),
    12
  );
}

/** A wallet-shaped Ed25519 keypair plus its derived enterprise (testnet) address. */
function makeWallet() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const rawPub = rawPublicKey(publicKey);
  const addr = new Address({
    network: 'testnet',
    paymentCreds: Credential.keyHash(blake2b_224(rawPub))
  });
  return {
    privateKey,
    rawPub,
    bech32: addr.toString(),
    addressBytes: new Uint8Array(addr.toBytes())
  };
}

/**
 * Builds a CIP-30 signData-shaped response from a private Ed25519 key.
 * Mirrors what a wallet would do.
 */
function buildCip30Signature(
  privateKey: crypto.KeyObject,
  rawPub: Uint8Array,
  addressBytes: Uint8Array,
  payloadUtf8: string
): { signature: string; key: string } {
  // COSE_Sign1 protected header bstr — a CBOR map:
  //   alg (1) = EdDSA (-8), "address" = raw address bytes
  const protectedBytes = Cbor.encode(new CborMap([
    { k: new CborUInt(1n), v: new CborNegInt(-8n) },
    { k: new CborText('address'), v: new CborBytes(addressBytes) }
  ]));
  const payloadBytes = new Uint8Array(Buffer.from(payloadUtf8, 'utf-8'));

  // Sign the COSE Sig_structure: [ "Signature1", protected, external_aad (empty), payload ]
  const sigStructure = Cbor.encode(new CborArray([
    new CborText('Signature1'),
    new CborBytes(protectedBytes),
    new CborBytes(new Uint8Array(0)),
    new CborBytes(payloadBytes)
  ]));
  const signature = crypto.sign(null, Buffer.from(sigStructure), privateKey);

  // COSE_Sign1 = [ protected, unprotected (empty map), payload, signature ]
  const cose1 = Cbor.encode(new CborArray([
    new CborBytes(protectedBytes),
    new CborMap([]),
    new CborBytes(payloadBytes),
    new CborBytes(new Uint8Array(signature))
  ]));

  // COSE_Key map: kty(1)=OKP(1), alg(3)=EdDSA(-8), crv(-1)=Ed25519(6), x(-2)=pubkey
  const coseKey = Cbor.encode(new CborMap([
    { k: new CborUInt(1n), v: new CborUInt(1n) },
    { k: new CborUInt(3n), v: new CborNegInt(-8n) },
    { k: new CborNegInt(-1n), v: new CborUInt(6n) },
    { k: new CborNegInt(-2n), v: new CborBytes(rawPub) }
  ]));

  return {
    signature: Buffer.from(cose1).toString('hex'),
    key: Buffer.from(coseKey).toString('hex')
  };
}

describe('AuthService', () => {
  let address: string;
  let privateKey: crypto.KeyObject;
  let rawPub: Uint8Array;
  let addressBytes: Uint8Array;

  beforeAll(() => {
    // Generate a fresh Ed25519 keypair, derive an enterprise address
    const wallet = makeWallet();
    privateKey = wallet.privateKey;
    rawPub = wallet.rawPub;
    address = wallet.bech32;
    addressBytes = wallet.addressBytes;
  });

  test('Nonce endpoint returns a fresh nonce + payload', async () => {
    const res = await POST('/auth/Nonce', { address });
    expect(res.data.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(res.data.payload).toBe(`FINCA login: ${res.data.nonce}`);
    expect(res.data.expiresAt).toBeTruthy();
  });

  test('Verify with a real signature returns a JWT', async () => {
    const nonceRes = await POST('/auth/Nonce', { address });
    const { nonce, payload } = nonceRes.data;

    const sig = buildCip30Signature(privateKey, rawPub, addressBytes, payload);

    const verifyRes = await POST('/auth/Verify', {
      address,
      nonce,
      signature: sig.signature,
      key: sig.key
    });
    expect(verifyRes.data.jwt).toMatch(/^eyJ/);
    expect(verifyRes.data.address).toBe(address);
  });

  test('Verify rejects a reused nonce', async () => {
    const nonceRes = await POST('/auth/Nonce', { address });
    const { nonce, payload } = nonceRes.data;
    const sig = buildCip30Signature(privateKey, rawPub, addressBytes, payload);

    await POST('/auth/Verify', { address, nonce, signature: sig.signature, key: sig.key });
    await expect(POST('/auth/Verify', { address, nonce, signature: sig.signature, key: sig.key }))
      .rejects.toMatchObject({ response: { status: 401 } });
  });

  test('Verify rejects when signer key does not match address', async () => {
    const nonceRes = await POST('/auth/Nonce', { address });
    const { nonce, payload } = nonceRes.data;

    // Sign with a DIFFERENT key (but claim the original address)
    const other = makeWallet();
    const sig = buildCip30Signature(other.privateKey, other.rawPub, addressBytes, payload);

    await expect(POST('/auth/Verify', { address, nonce, signature: sig.signature, key: sig.key }))
      .rejects.toMatchObject({ response: { status: 401 } });
  });
});

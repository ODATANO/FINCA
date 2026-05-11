/**
 * AuthService integration tests — covers the nonce/verify endpoints and the
 * happy path of signature verification using a freshly generated Ed25519
 * key plus a manually-constructed COSE_Sign1 payload.
 */
import cds from '@sap/cds';
import * as crypto from 'node:crypto';
import * as MS from '@emurgo/cardano-message-signing-nodejs';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';

const { POST } = (cds as any).test(__dirname + '/..');

/**
 * Builds a CIP-30 signData-shaped response from a private Ed25519 key.
 * Mirrors what a wallet would do.
 */
function buildCip30Signature(
  privateKey: CSL.PrivateKey,
  pubKey: CSL.PublicKey,
  addressBytes: Uint8Array,
  payloadUtf8: string
): { signature: string; key: string } {
  // Build COSE_Sign1 protected headers (CBOR map):
  //   alg (1) = EdDSA (-8), address ("address") = raw address bytes
  const protectedMap = MS.HeaderMap.new();
  protectedMap.set_algorithm_id(MS.Label.from_algorithm_id(MS.AlgorithmId.EdDSA));
  protectedMap.set_header(
    MS.Label.new_text('address'),
    MS.CBORValue.new_bytes(addressBytes)
  );
  const protectedHeaders = MS.ProtectedHeaderMap.new(protectedMap);
  const headers = MS.Headers.new(protectedHeaders, MS.HeaderMap.new());

  const builder = MS.COSESign1Builder.new(
    headers,
    Buffer.from(payloadUtf8, 'utf-8'),
    false
  );
  const toSign = builder.make_data_to_sign().to_bytes();
  const signature = privateKey.sign(Buffer.from(toSign)).to_bytes();
  const cose1 = builder.build(Buffer.from(signature));

  // COSE_Key with kty=OKP (1), crv=Ed25519 (6), x = pubkey bytes (-2)
  const coseKey = MS.COSEKey.new(MS.Label.from_key_type(MS.KeyType.OKP));
  coseKey.set_algorithm_id(MS.Label.from_algorithm_id(MS.AlgorithmId.EdDSA));
  coseKey.set_header(
    MS.Label.new_int(MS.Int.new_negative(MS.BigNum.from_str('1'))),  // crv
    MS.CBORValue.new_int(MS.Int.new_i32(6))                          // Ed25519
  );
  coseKey.set_header(
    MS.Label.new_int(MS.Int.new_negative(MS.BigNum.from_str('2'))),  // x
    MS.CBORValue.new_bytes(pubKey.as_bytes())
  );

  return {
    signature: Buffer.from(cose1.to_bytes()).toString('hex'),
    key: Buffer.from(coseKey.to_bytes()).toString('hex')
  };
}

describe('AuthService', () => {
  let address: string;
  let privateKey: CSL.PrivateKey;
  let pubKey: CSL.PublicKey;
  let addressBytes: Uint8Array;

  beforeAll(() => {
    // Generate a fresh Ed25519 keypair, derive an enterprise address
    const seed = crypto.randomBytes(32);
    privateKey = CSL.PrivateKey.from_normal_bytes(seed);
    pubKey = privateKey.to_public();
    const stakeCred = CSL.Credential.from_keyhash(pubKey.hash());
    const enterprise = CSL.EnterpriseAddress.new(0 /* testnet */, stakeCred);
    const addr = enterprise.to_address();
    address = addr.to_bech32();
    addressBytes = addr.to_bytes();
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

    const sig = buildCip30Signature(privateKey, pubKey, addressBytes, payload);

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
    const sig = buildCip30Signature(privateKey, pubKey, addressBytes, payload);

    await POST('/auth/Verify', { address, nonce, signature: sig.signature, key: sig.key });
    await expect(POST('/auth/Verify', { address, nonce, signature: sig.signature, key: sig.key }))
      .rejects.toMatchObject({ response: { status: 401 } });
  });

  test('Verify rejects when signer key does not match address', async () => {
    const nonceRes = await POST('/auth/Nonce', { address });
    const { nonce, payload } = nonceRes.data;

    // Sign with a DIFFERENT key
    const otherSeed = crypto.randomBytes(32);
    const otherSk = CSL.PrivateKey.from_normal_bytes(otherSeed);
    const otherPk = otherSk.to_public();
    const sig = buildCip30Signature(otherSk, otherPk, addressBytes, payload);

    await expect(POST('/auth/Verify', { address, nonce, signature: sig.signature, key: sig.key }))
      .rejects.toMatchObject({ response: { status: 401 } });
  });
});

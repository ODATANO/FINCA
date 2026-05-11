/**
 * CIP-30 signData verifier.
 *
 * Validates the COSE_Sign1 signature returned by `cardano.<wallet>.signData(addr, payload)`
 * against the connected wallet's address. Confirms three things:
 *   1. Ed25519 signature is valid over the COSE Sig_structure
 *   2. The signer's public key hashes to the VKH embedded in the bech32 address
 *   3. The signed payload equals the expected message (anti-replay)
 */
import * as crypto from 'node:crypto';
import * as MS from '@emurgo/cardano-message-signing-nodejs';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';

export interface Cip30Signature {
  /** Hex-encoded COSE_Sign1 CBOR */
  signature: string;
  /** Hex-encoded COSE_Key CBOR */
  key: string;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verify a CIP-30 signData signature.
 *
 * @param sig — { signature, key } from CIP-30 signData
 * @param expectedAddressBech32 — Bech32 address the wallet claimed to sign with
 * @param expectedPayloadUtf8 — The UTF-8 message the user agreed to sign
 */
export function verifyCip30Signature(
  sig: Cip30Signature,
  expectedAddressBech32: string,
  expectedPayloadUtf8: string
): VerifyResult {
  let cose1: MS.COSESign1;
  let coseKey: MS.COSEKey;
  try {
    cose1 = MS.COSESign1.from_bytes(Buffer.from(sig.signature, 'hex'));
    coseKey = MS.COSEKey.from_bytes(Buffer.from(sig.key, 'hex'));
  } catch (e: any) {
    return { valid: false, reason: `Malformed COSE: ${e.message}` };
  }

  // Extract public key from COSE_Key (-2 = OKP "x" coord, the raw Ed25519 pubkey)
  const xLabel = MS.Label.new_int(MS.Int.new_negative(MS.BigNum.from_str('2')));
  const xCbor = coseKey.header(xLabel);
  if (!xCbor) return { valid: false, reason: 'COSE_Key missing -2 (x) parameter' };
  const pubKeyBytes = xCbor.as_bytes();
  if (!pubKeyBytes || pubKeyBytes.length !== 32) {
    return { valid: false, reason: 'Ed25519 pubkey must be 32 bytes' };
  }

  // VKH check: hash(pubkey) must equal the payment-cred VKH inside the address
  let expectedVkh: Uint8Array;
  try {
    const addr = CSL.Address.from_bech32(expectedAddressBech32);
    const baseAddr = CSL.BaseAddress.from_address(addr) ?? CSL.EnterpriseAddress.from_address(addr);
    if (!baseAddr) return { valid: false, reason: 'Address is neither base nor enterprise' };
    expectedVkh = baseAddr.payment_cred().to_keyhash()!.to_bytes();
  } catch (e: any) {
    return { valid: false, reason: `Bad bech32 address: ${e.message}` };
  }

  const actualVkh = CSL.PublicKey.from_bytes(pubKeyBytes).hash().to_bytes();
  if (!bytesEqual(expectedVkh, actualVkh)) {
    return { valid: false, reason: 'Signer key does not match address VKH' };
  }

  // Payload check
  const payloadBytes = cose1.payload();
  if (!payloadBytes) return { valid: false, reason: 'COSE_Sign1 has no payload (detached?)' };
  const payloadUtf8 = Buffer.from(payloadBytes).toString('utf-8');
  if (payloadUtf8 !== expectedPayloadUtf8) {
    return { valid: false, reason: 'Payload mismatch' };
  }

  // Verify Ed25519 over the COSE Sig_structure
  const sigStructure = cose1.signed_data(undefined, undefined).to_bytes();
  const signatureBytes = cose1.signature();
  const ok = crypto.verify(
    null,
    Buffer.from(sigStructure),
    {
      key: Buffer.concat([
        // SubjectPublicKeyInfo DER prefix for Ed25519: 12-byte header + 32-byte key
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(pubKeyBytes)
      ]),
      format: 'der',
      type: 'spki'
    },
    Buffer.from(signatureBytes)
  );

  return ok ? { valid: true } : { valid: false, reason: 'Ed25519 signature invalid' };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

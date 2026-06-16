/**
 * Chain Adapter — ODATANO service wrapper for FINCA.
 *
 * Thin abstraction over CardanoTransactionService and CardanoODataService.
 * All blockchain interaction goes through here.
 */
import cds from '@sap/cds';

const LOG = cds.log('chain-adapter');

/** Result from building a metadata transaction */
export interface BuildResult {
  buildId: string;
  unsignedCbor: string;
  txBodyHash: string;
  fee: string;
}

/** Result from submitting a signed transaction */
export interface SubmitResult {
  txHash: string;
  status: string;
}

/** Transaction confirmation status */
export interface TxStatus {
  confirmed: boolean;
  slot?: number;
  blockNumber?: number;
}

/** On-chain metadata entry */
export interface OnChainMetadata {
  label: string;
  payload: string;
}

/** Result of verifying a CIP-30 signData (COSE_Sign1) message signature. */
export interface DataSignatureResult {
  valid: boolean;
  /** Failure detail when not valid */
  reason?: string;
  /** UTF-8 of the signed payload, echoed back */
  signedPayload?: string;
  /** Hex blake2b-224 of the signer public key */
  signerVkh?: string;
}

/**
 * Build an unsigned metadata transaction via ODATANO.
 *
 * Uses BuildTransactionWithMetadata — sends ADA to self with metadata attached.
 * The metadata (label 1447) is embedded in the TX body.
 */
export async function buildMetadataTx(
  metadataJson: object,
  senderAddress: string
): Promise<BuildResult> {
  const txSrv = await cds.connect.to('CardanoTransactionService');

  LOG.info('Building metadata TX for address:', senderAddress);

  const result = await txSrv.send('BuildTransactionWithMetadata', {
    senderAddress,
    recipientAddress: senderAddress,  // Self-send (metadata-only)
    lovelaceAmount: '2000000',        // Min UTxO (2 ADA)
    changeAddress: senderAddress,
    metadataJson: JSON.stringify(metadataJson)
  });

  LOG.info('Build complete. ID:', result.id, 'Fee:', result.fee);

  return {
    buildId: result.id,
    unsignedCbor: result.unsignedTxCbor,
    txBodyHash: result.txBodyHash,
    fee: result.fee
  };
}

/**
 * Create a signing request for a build (required before CIP-30 witness-set submit).
 * Idempotent — ODATANO returns the existing pending request if one already exists.
 */
export async function createSigningRequest(
  buildId: string,
  message: string
): Promise<string> {
  const signSrv = await cds.connect.to('CardanoSignService');

  const result = await signSrv.send('CreateSigningRequest', { buildId, message });

  LOG.info('Signing request created. ID:', result.id, 'for build:', buildId);
  return result.id;
}

/**
 * Submit a signed transaction to the blockchain via CardanoSignService.
 *
 * Accepts EITHER a full signed Transaction CBOR or just a TransactionWitnessSet
 * (CIP-30 wallets return the latter). ODATANO auto-detects and merges with the
 * unsigned tx stored on the signing request before submission.
 */
export async function submitSigned(
  signingRequestId: string,
  signedTxCbor: string,
  walletAddress?: string
): Promise<SubmitResult> {
  const signSrv = await cds.connect.to('CardanoSignService');

  LOG.info('Submitting signed TX for signing request:', signingRequestId);

  const result = await signSrv.send('SubmitVerifiedTransaction', {
    signingRequestId,
    signedTxCbor,
    signerType: 'browser-wallet',
    signerInfo: 'CIP-30',
    address: walletAddress
  });

  LOG.info('Submitted. TX Hash:', result.txHash, 'Status:', result.status);

  return {
    txHash: result.txHash,
    status: result.status
  };
}

/**
 * Check if a transaction has been confirmed on-chain.
 */
export async function getTxStatus(txHash: string): Promise<TxStatus> {
  const oDataSrv = await cds.connect.to('CardanoODataService');

  try {
    const result = await oDataSrv.send('GetTransactionByHash', {
      hash: txHash
    });

    return {
      confirmed: true,
      slot: result.slot,
      blockNumber: result.blockHeight
    };
  } catch (err: any) {
    // 404 means TX not yet confirmed
    if (err.code === 404 || err.status === 404) {
      return { confirmed: false };
    }
    throw err;
  }
}

/**
 * Read metadata from a confirmed on-chain transaction.
 */
export async function getOnChainMetadata(txHash: string): Promise<OnChainMetadata[]> {
  const oDataSrv = await cds.connect.to('CardanoODataService');

  const result = await oDataSrv.send('GetMetadataByTxHash', {
    tx_hash: txHash
  });

  return (result || []).map((m: any) => ({
    label: m.label,
    payload: m.payload
  }));
}

/**
 * Verify a CIP-30 signData (COSE_Sign1) message signature via ODATANO.
 *
 * Stateless crypto check: confirms the Ed25519 signature, that the signer key
 * hashes to the address payment credential, and that the signed payload matches
 * `expectedPayload`. Nonce/replay/session handling stays in the caller.
 */
export async function verifyDataSignature(
  address: string,
  coseSignature: string,
  coseKey: string,
  expectedPayload: string
): Promise<DataSignatureResult> {
  const signSrv = await cds.connect.to('CardanoSignService');

  const result = await signSrv.send('VerifyDataSignature', {
    address,
    coseSignature,
    coseKey,
    expectedPayload
  });

  return {
    valid: result.valid,
    reason: result.reason,
    signedPayload: result.signedPayload,
    signerVkh: result.signerVkh
  };
}

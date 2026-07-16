/**
 * Unit tests for the chain-adapter — verifies that each function sends the
 * correct ODATANO action with the expected payload and maps the response
 * shape correctly. cds.connect.to is mocked so no real backend is needed.
 */
import type { MockInstance } from 'vitest';
import cds from '@sap/cds';
import * as chain from '../srv/lib/chain-adapter';

describe('chain-adapter', () => {
  const txSrv = { send: vi.fn() };
  const oDataSrv = { send: vi.fn() };
  const signSrv = { send: vi.fn() };

  let connectSpy: MockInstance;

  beforeEach(() => {
    txSrv.send.mockReset();
    oDataSrv.send.mockReset();
    signSrv.send.mockReset();
    connectSpy = vi.spyOn(cds.connect, 'to').mockImplementation(async (name: any) => {
      if (name === 'CardanoTransactionService') return txSrv as any;
      if (name === 'CardanoODataService') return oDataSrv as any;
      if (name === 'CardanoSignService') return signSrv as any;
      throw new Error(`unexpected service: ${name}`);
    });
  });

  afterEach(() => {
    connectSpy.mockRestore();
  });

  describe('buildMetadataTx', () => {
    test('sends BuildTransactionWithMetadata with self-send + 2 ADA min UTxO', async () => {
      txSrv.send.mockResolvedValue({
        id: 'build-uuid-1',
        unsignedTxCbor: 'ff00aa',
        txBodyHash: 'bb00cc',
        fee: '180000'
      });

      const result = await chain.buildMetadataTx({ foo: 'bar' }, 'addr_test1abc');

      expect(txSrv.send).toHaveBeenCalledWith('BuildTransactionWithMetadata', {
        senderAddress: 'addr_test1abc',
        recipientAddress: 'addr_test1abc',
        lovelaceAmount: '2000000',
        changeAddress: 'addr_test1abc',
        metadataJson: JSON.stringify({ foo: 'bar' })
      });
      expect(result).toEqual({
        buildId: 'build-uuid-1',
        unsignedCbor: 'ff00aa',
        txBodyHash: 'bb00cc',
        fee: '180000'
      });
    });

    test('propagates errors from CardanoTransactionService', async () => {
      txSrv.send.mockRejectedValue(new Error('backend down'));
      await expect(chain.buildMetadataTx({}, 'addr_test1abc')).rejects.toThrow('backend down');
    });
  });

  describe('createSigningRequest', () => {
    test('returns signing request id', async () => {
      signSrv.send.mockResolvedValue({ id: 'sign-req-1' });

      const id = await chain.createSigningRequest('build-1', 'FINCA batch B-1');

      expect(signSrv.send).toHaveBeenCalledWith('CreateSigningRequest', {
        buildId: 'build-1',
        message: 'FINCA batch B-1'
      });
      expect(id).toBe('sign-req-1');
    });
  });

  describe('submitSigned', () => {
    test('sends witness-set with browser-wallet/CIP-30 signer info', async () => {
      signSrv.send.mockResolvedValue({ txHash: 'tx-deadbeef', status: 'SUBMITTED' });

      const result = await chain.submitSigned('sign-req-1', 'ee00ff', 'addr_test1abc');

      expect(signSrv.send).toHaveBeenCalledWith('SubmitVerifiedTransaction', {
        signingRequestId: 'sign-req-1',
        signedTxCbor: 'ee00ff',
        signerType: 'browser-wallet',
        signerInfo: 'CIP-30',
        address: 'addr_test1abc'
      });
      expect(result).toEqual({ txHash: 'tx-deadbeef', status: 'SUBMITTED' });
    });

    test('walletAddress is optional', async () => {
      signSrv.send.mockResolvedValue({ txHash: 't', status: 'SUBMITTED' });
      await chain.submitSigned('sign-req-1', 'ee00ff');
      expect(signSrv.send.mock.calls[0][1]).toMatchObject({ address: undefined });
    });
  });

  describe('getTxStatus', () => {
    test('returns confirmed=true with slot/block when ODATANO finds the tx', async () => {
      oDataSrv.send.mockResolvedValue({ slot: 999, blockHeight: 12345 });

      const status = await chain.getTxStatus('tx-1');

      expect(oDataSrv.send).toHaveBeenCalledWith('GetTransactionByHash', { hash: 'tx-1' });
      expect(status).toEqual({ confirmed: true, slot: 999, blockNumber: 12345 });
    });

    test('returns confirmed=false on 404 (err.code)', async () => {
      oDataSrv.send.mockRejectedValue(Object.assign(new Error('not found'), { code: 404 }));
      const status = await chain.getTxStatus('tx-1');
      expect(status).toEqual({ confirmed: false });
    });

    test('returns confirmed=false on 404 (err.status)', async () => {
      oDataSrv.send.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
      const status = await chain.getTxStatus('tx-1');
      expect(status).toEqual({ confirmed: false });
    });

    test('rethrows non-404 errors', async () => {
      oDataSrv.send.mockRejectedValue(Object.assign(new Error('500 bad'), { code: 500 }));
      await expect(chain.getTxStatus('tx-1')).rejects.toThrow('500 bad');
    });
  });

  describe('getOnChainMetadata', () => {
    test('maps ODATANO response to {label, payload} entries', async () => {
      oDataSrv.send.mockResolvedValue([
        { label: '1447', payload: '{"x":1}', extra: 'ignored' },
        { label: '674', payload: 'note' }
      ]);

      const out = await chain.getOnChainMetadata('tx-1');

      expect(oDataSrv.send).toHaveBeenCalledWith('GetMetadataByTxHash', { txHash: 'tx-1' });
      expect(out).toEqual([
        { label: '1447', payload: '{"x":1}' },
        { label: '674', payload: 'note' }
      ]);
    });

    test('returns [] when ODATANO returns null', async () => {
      oDataSrv.send.mockResolvedValue(null);
      const out = await chain.getOnChainMetadata('tx-1');
      expect(out).toEqual([]);
    });

    test('returns [] when ODATANO returns undefined', async () => {
      oDataSrv.send.mockResolvedValue(undefined);
      const out = await chain.getOnChainMetadata('tx-1');
      expect(out).toEqual([]);
    });
  });
});

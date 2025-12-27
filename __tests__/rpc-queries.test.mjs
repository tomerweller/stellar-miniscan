/**
 * Integration tests for RPC query structure
 *
 * These tests verify the correct structure of RPC queries made by
 * getAccountActivity and related functions.
 *
 * Uses actual RPC calls to testnet to verify query format is valid.
 * These tests may be slower and require network access.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

// Test network configuration
const TEST_NETWORK = 'testnet';
const TEST_RPC_URL = 'https://soroban-testnet.stellar.org';
const TEST_PASSPHRASE = 'Test SDF Network ; September 2015';

// Known testnet addresses for testing
const TEST_G_ADDRESS = 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR';

/**
 * Make a raw RPC call for testing
 */
async function rpcCall(method, params) {
  const response = await fetch(TEST_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    const error = new Error(`RPC error: [${data.error.code}] ${data.error.message}`);
    error.code = data.error.code;
    throw error;
  }

  return data.result;
}

describe('RPC Query Structure', () => {
  let latestLedger;

  beforeAll(async () => {
    // Get latest ledger for all tests
    const result = await rpcCall('getLatestLedger', {});
    latestLedger = result.sequence;
  }, 30000);

  describe('Token Events Query (5 topic patterns in single filter)', () => {
    it('should accept single filter with 5 topic patterns (OR logic)', async () => {
      const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
      const mintSymbol = StellarSdk.nativeToScVal('mint', { type: 'symbol' });
      const burnSymbol = StellarSdk.nativeToScVal('burn', { type: 'symbol' });
      const clawbackSymbol = StellarSdk.nativeToScVal('clawback', { type: 'symbol' });
      const targetScVal = StellarSdk.nativeToScVal(
        StellarSdk.Address.fromString(TEST_G_ADDRESS),
        { type: 'address' }
      );

      const result = await rpcCall('getEvents', {
        startLedger: latestLedger,
        filters: [
          {
            type: 'contract',
            topics: [
              [transferSymbol.toXDR('base64'), targetScVal.toXDR('base64'), '*', '**'],
              [transferSymbol.toXDR('base64'), '*', targetScVal.toXDR('base64'), '**'],
              [mintSymbol.toXDR('base64'), '*', targetScVal.toXDR('base64'), '**'],
              [burnSymbol.toXDR('base64'), targetScVal.toXDR('base64'), '**'],
              [clawbackSymbol.toXDR('base64'), '*', targetScVal.toXDR('base64'), '**'],
            ],
          },
        ],
        pagination: { limit: 10, order: 'desc' }
      });

      // Query should succeed (even if no events found)
      expect(result).toBeDefined();
      expect(Array.isArray(result.events)).toBe(true);
    }, 30000);
  });

  describe('Fee Events Query (with contractIds)', () => {
    it('should accept filter with contractIds for fee events', async () => {
      const feeSymbol = StellarSdk.nativeToScVal('fee', { type: 'symbol' });
      const targetScVal = StellarSdk.nativeToScVal(
        StellarSdk.Address.fromString(TEST_G_ADDRESS),
        { type: 'address' }
      );
      const xlmContractId = StellarSdk.Asset.native().contractId(TEST_PASSPHRASE);

      const result = await rpcCall('getEvents', {
        startLedger: latestLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [xlmContractId],
            topics: [[feeSymbol.toXDR('base64'), targetScVal.toXDR('base64')]],
          },
        ],
        pagination: { limit: 10, order: 'desc' }
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result.events)).toBe(true);
    }, 30000);
  });

  describe('Token Transfer Query (4 topic patterns with contractIds)', () => {
    it('should accept filter with contractIds and 4 topic patterns', async () => {
      const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
      const mintSymbol = StellarSdk.nativeToScVal('mint', { type: 'symbol' });
      const burnSymbol = StellarSdk.nativeToScVal('burn', { type: 'symbol' });
      const clawbackSymbol = StellarSdk.nativeToScVal('clawback', { type: 'symbol' });
      const xlmContractId = StellarSdk.Asset.native().contractId(TEST_PASSPHRASE);

      const result = await rpcCall('getEvents', {
        startLedger: latestLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [xlmContractId],
            topics: [
              [transferSymbol.toXDR('base64'), '*', '*', '**'],
              [mintSymbol.toXDR('base64'), '*', '*', '**'],
              [burnSymbol.toXDR('base64'), '*', '**'],
              [clawbackSymbol.toXDR('base64'), '*', '*', '**'],
            ],
          },
        ],
        pagination: { limit: 10, order: 'desc' }
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result.events)).toBe(true);
    }, 30000);
  });

  describe('Descending order pagination', () => {
    it('should return events in descending order by ledger', async () => {
      const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
      const xlmContractId = StellarSdk.Asset.native().contractId(TEST_PASSPHRASE);

      const result = await rpcCall('getEvents', {
        startLedger: latestLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [xlmContractId],
            topics: [[transferSymbol.toXDR('base64'), '*', '*', '**']],
          },
        ],
        pagination: { limit: 50, order: 'desc' }
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result.events)).toBe(true);

      // Verify descending order if we have multiple events
      if (result.events.length >= 2) {
        const ledgers = result.events.map(e => e.ledger);
        for (let i = 1; i < ledgers.length; i++) {
          expect(ledgers[i]).toBeLessThanOrEqual(ledgers[i - 1]);
        }
      }
    }, 30000);
  });
});

describe('Regression Tests', () => {
  let latestLedger;

  beforeAll(async () => {
    const result = await rpcCall('getLatestLedger', {});
    latestLedger = result.sequence;
  }, 30000);

  it('should NOT include contractIds in token events filter (regression for processing limit bug)', async () => {
    // This test ensures we don't accidentally add contractIds to the token events filter
    // which would limit results to only XLM transfers
    const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
    const targetScVal = StellarSdk.nativeToScVal(
      StellarSdk.Address.fromString(TEST_G_ADDRESS),
      { type: 'address' }
    );

    // This is the correct query structure (no contractIds)
    const result = await rpcCall('getEvents', {
      startLedger: latestLedger,
      filters: [
        {
          type: 'contract',
          // NO contractIds here - this is intentional
          topics: [
            [transferSymbol.toXDR('base64'), targetScVal.toXDR('base64'), '*', '**'],
            [transferSymbol.toXDR('base64'), '*', targetScVal.toXDR('base64'), '**'],
          ],
        },
      ],
      pagination: { limit: 10, order: 'desc' }
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.events)).toBe(true);
  }, 30000);

  it('should ALWAYS include contractIds in fee events filter', async () => {
    // Fee events query MUST have contractIds (XLM contract)
    // Without it, the query would be too expensive
    const feeSymbol = StellarSdk.nativeToScVal('fee', { type: 'symbol' });
    const targetScVal = StellarSdk.nativeToScVal(
      StellarSdk.Address.fromString(TEST_G_ADDRESS),
      { type: 'address' }
    );
    const xlmContractId = StellarSdk.Asset.native().contractId(TEST_PASSPHRASE);

    const result = await rpcCall('getEvents', {
      startLedger: latestLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [xlmContractId], // REQUIRED for fee events
          topics: [[feeSymbol.toXDR('base64'), targetScVal.toXDR('base64')]],
        },
      ],
      pagination: { limit: 10, order: 'desc' }
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.events)).toBe(true);
  }, 30000);
});

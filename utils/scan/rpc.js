/**
 * RPC client for Lumenitos Scan
 *
 * Provides a configurable RPC client for Soroban RPC calls.
 * Accepts config injection for easier testing.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

/**
 * Make a direct JSON-RPC call to the RPC server
 * @param {string} rpcUrl - The RPC server URL
 * @param {string} method - RPC method name
 * @param {object} params - RPC parameters
 * @returns {Promise<object>} RPC result
 */
export async function rpcCall(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.error) {
    const errorCode = data.error.code;
    const errorMessage = data.error.message || JSON.stringify(data.error);
    const error = new Error(`RPC error: [${errorCode}] ${errorMessage}`);
    error.code = errorCode;
    throw error;
  }

  return data.result;
}

/**
 * Create an RPC client with injected configuration
 * @param {object} config - Configuration object
 * @param {string} config.rpcUrl - Soroban RPC URL
 * @param {string} config.networkPassphrase - Network passphrase
 * @returns {object} RPC client instance
 */
export function createRpcClient(config) {
  const { rpcUrl, networkPassphrase } = config;

  return {
    /**
     * Get the latest ledger sequence
     * @returns {Promise<number>} Latest ledger sequence
     */
    async getLatestLedger() {
      const result = await rpcCall(rpcUrl, 'getLatestLedger', {});
      return result.sequence;
    },

    /**
     * Get events with the given filters
     * @param {object} params - getEvents parameters
     * @returns {Promise<object>} Events result
     */
    async getEvents(params) {
      return rpcCall(rpcUrl, 'getEvents', params);
    },

    /**
     * Get transaction by hash
     * @param {string} txHash - Transaction hash
     * @returns {Promise<object>} Transaction data
     */
    async getTransaction(txHash) {
      return rpcCall(rpcUrl, 'getTransaction', { hash: txHash });
    },

    /**
     * Get ledger entries by keys
     * @param {string[]} keys - Base64-encoded XDR keys
     * @returns {Promise<object>} Ledger entries result
     */
    async getLedgerEntries(keys) {
      return rpcCall(rpcUrl, 'getLedgerEntries', { keys });
    },

    /**
     * Simulate a transaction
     * @param {StellarSdk.Transaction} transaction - The transaction to simulate
     * @returns {Promise<object>} Simulation response
     */
    async simulateTransaction(transaction) {
      const server = new StellarSdk.rpc.Server(rpcUrl);
      return server.simulateTransaction(transaction);
    },

    /**
     * Get the XLM (native asset) contract ID for this network
     * @returns {string} XLM contract ID
     */
    getXlmContractId() {
      return StellarSdk.Asset.native().contractId(networkPassphrase);
    },

    /**
     * Get the network passphrase
     * @returns {string}
     */
    getNetworkPassphrase() {
      return networkPassphrase;
    },

    /**
     * Get the RPC URL
     * @returns {string}
     */
    getRpcUrl() {
      return rpcUrl;
    },
  };
}

/**
 * Build topic filter XDR for token events
 * @param {string} targetAddress - Address to filter for
 * @returns {object} Topic filter configuration
 */
export function buildTokenEventFilters(targetAddress) {
  const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
  const mintSymbol = StellarSdk.nativeToScVal('mint', { type: 'symbol' });
  const burnSymbol = StellarSdk.nativeToScVal('burn', { type: 'symbol' });
  const clawbackSymbol = StellarSdk.nativeToScVal('clawback', { type: 'symbol' });
  const targetScVal = StellarSdk.nativeToScVal(
    StellarSdk.Address.fromString(targetAddress),
    { type: 'address' }
  );

  return {
    type: 'contract',
    topics: [
      [transferSymbol.toXDR('base64'), targetScVal.toXDR('base64'), '*', '**'],  // transfers FROM
      [transferSymbol.toXDR('base64'), '*', targetScVal.toXDR('base64'), '**'],  // transfers TO
      [mintSymbol.toXDR('base64'), '*', targetScVal.toXDR('base64'), '**'],      // mint TO
      [burnSymbol.toXDR('base64'), targetScVal.toXDR('base64'), '**'],           // burn FROM
      [clawbackSymbol.toXDR('base64'), '*', targetScVal.toXDR('base64'), '**'],  // clawback FROM
    ],
  };
}

/**
 * Build topic filter XDR for fee events
 * @param {string} targetAddress - Address to filter for
 * @param {string} xlmContractId - XLM contract ID
 * @returns {object} Topic filter configuration
 */
export function buildFeeEventFilters(targetAddress, xlmContractId) {
  const feeSymbol = StellarSdk.nativeToScVal('fee', { type: 'symbol' });
  const targetScVal = StellarSdk.nativeToScVal(
    StellarSdk.Address.fromString(targetAddress),
    { type: 'address' }
  );

  return {
    type: 'contract',
    contractIds: [xlmContractId],
    topics: [[feeSymbol.toXDR('base64'), targetScVal.toXDR('base64')]],
  };
}

/**
 * Build topic filter for token activity on a specific contract
 * @param {string} tokenContractId - Token contract ID
 * @returns {object} Topic filter configuration
 */
export function buildTokenActivityFilters(tokenContractId) {
  const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
  const mintSymbol = StellarSdk.nativeToScVal('mint', { type: 'symbol' });
  const burnSymbol = StellarSdk.nativeToScVal('burn', { type: 'symbol' });
  const clawbackSymbol = StellarSdk.nativeToScVal('clawback', { type: 'symbol' });

  return {
    type: 'contract',
    contractIds: [tokenContractId],
    topics: [
      [transferSymbol.toXDR('base64'), '*', '*', '**'],
      [mintSymbol.toXDR('base64'), '*', '*', '**'],
      [burnSymbol.toXDR('base64'), '*', '**'],
      [clawbackSymbol.toXDR('base64'), '*', '*', '**'],
    ],
  };
}

/**
 * Build topic filter for network-wide token activity
 * @returns {object} Topic filter configuration
 */
export function buildNetworkActivityFilters() {
  const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
  const mintSymbol = StellarSdk.nativeToScVal('mint', { type: 'symbol' });
  const burnSymbol = StellarSdk.nativeToScVal('burn', { type: 'symbol' });
  const clawbackSymbol = StellarSdk.nativeToScVal('clawback', { type: 'symbol' });

  return {
    type: 'contract',
    topics: [
      [transferSymbol.toXDR('base64'), '*', '*', '**'],
      [mintSymbol.toXDR('base64'), '*', '*', '**'],
      [burnSymbol.toXDR('base64'), '*', '**'],
      [clawbackSymbol.toXDR('base64'), '*', '*', '**'],
    ],
  };
}

/**
 * Build topic filter for transfers only (fallback for network activity)
 * @returns {object} Topic filter configuration
 */
export function buildTransfersOnlyFilters() {
  const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });

  return {
    type: 'contract',
    topics: [[transferSymbol.toXDR('base64'), '*', '*', '**']],
  };
}

/**
 * Stellar MiniScan utilities
 *
 * This module provides the main API for the block explorer feature.
 * It re-exports from specialized modules and provides high-level functions
 * that combine RPC calls with event parsing.
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import config from '../config.js';

// Re-export helpers for convenient imports
export * from './helpers.js';
export * from './operations.js';

// Re-export from new modules
export { isValidAddress, extractContractIds } from './validation.js';
export { storageManager, createStorageManager } from './storage.js';
export {
  parseTokenEvent,
  parseFeeEvent,
  parseContractEvent,
  parseTransferEvent,
  parseTransferEventGeneric,
} from './parsers.js';
export {
  createRpcClient,
  rpcCall,
  buildTokenEventFilters,
  buildFeeEventFilters,
  buildTokenActivityFilters,
} from './rpc.js';

// Import for internal use
import { parseTokenEvent, parseFeeEvent, parseContractEvent } from './parsers.js';
import {
  createRpcClient,
  rpcCall as rpcCallBase,
  buildTokenEventFilters,
  buildFeeEventFilters,
  buildTokenActivityFilters,
  buildNetworkActivityFilters,
  buildTransfersOnlyFilters,
} from './rpc.js';
import { storageManager } from './storage.js';
import * as cap67db from './cap67db.js';

// XDR decoder state (lazy loaded WASM)
let xdrDecoderModule = null;
let xdrDecoderReady = false;

/**
 * Get current RPC client based on config
 * @returns {object} RPC client instance
 */
function getRpcClient() {
  return createRpcClient({
    rpcUrl: config.stellar.sorobanRpcUrl,
    networkPassphrase: config.networkPassphrase,
    rpcTimeoutMs: config.rpc.timeoutMs,
    rpcMaxRetries: config.rpc.maxRetries,
    rpcBackoffMs: config.rpc.backoffMs,
    rpcBackoffMaxMs: config.rpc.backoffMaxMs,
  });
}

/**
 * Make a direct JSON-RPC call using current config
 * @param {string} method - RPC method name
 * @param {object} params - RPC parameters
 * @returns {Promise<object>} RPC result
 */
async function rpcCall(method, params) {
  return rpcCallBase(config.stellar.sorobanRpcUrl, method, params, {
    timeoutMs: config.rpc.timeoutMs,
    maxRetries: config.rpc.maxRetries,
    backoffMs: config.rpc.backoffMs,
    backoffMaxMs: config.rpc.backoffMaxMs,
  });
}

/**
 * Get the latest ledger sequence from the RPC
 * @returns {Promise<number>} Latest ledger sequence
 */
async function getLatestLedger() {
  const result = await rpcCall('getLatestLedger', {});
  return result.sequence;
}

/**
 * Get the ledger range info from the RPC
 * Returns ledger numbers and approximate timestamps (based on ~5 sec per ledger)
 * @returns {Promise<{latestLedger: number, oldestLedger: number, oldestDate: Date, latestDate: Date}>}
 */
export async function getLedgerRange() {
  const result = await rpcCall('getHealth');
  const { latestLedger, oldestLedger } = result;

  // Calculate approximate dates (ledgers close every ~5 seconds)
  const now = new Date();
  const ledgerDiff = latestLedger - oldestLedger;
  const secondsDiff = ledgerDiff * 5; // ~5 seconds per ledger
  const oldestDate = new Date(now.getTime() - secondsDiff * 1000);

  return {
    latestLedger,
    oldestLedger,
    oldestDate,
    latestDate: now,
  };
}

/**
 * Create an RPC server for scan operations
 * Uses the shared RPC URL from config
 */
function createScanRpcServer() {
  return new StellarSdk.rpc.Server(config.stellar.sorobanRpcUrl);
}

// ============================================
// Token Balance & Metadata
// ============================================

/**
 * Get raw balance for any SEP-41 token
 * @param {string} address - The address to check (G... or C...)
 * @param {string} tokenContractId - The token contract ID
 * @param {object} deps - Dependencies
 * @returns {Promise<string>} The raw balance as a string (not formatted)
 */
export async function getTokenBalance(address, tokenContractId, { rpcServer } = {}) {
  rpcServer = rpcServer || createScanRpcServer();

  try {
    const contract = new StellarSdk.Contract(tokenContractId);
    const addressObj = new StellarSdk.Address(address);

    const placeholderKeypair = StellarSdk.Keypair.random();
    const placeholderAccount = new StellarSdk.Account(placeholderKeypair.publicKey(), '0');

    const transaction = new StellarSdk.TransactionBuilder(placeholderAccount, {
      fee: '10000',
      networkPassphrase: config.networkPassphrase
    })
      .addOperation(contract.call('balance', addressObj.toScVal()))
      .setTimeout(30)
      .build();

    const simulationResponse = await rpcServer.simulateTransaction(transaction);

    if (StellarSdk.rpc.Api.isSimulationSuccess(simulationResponse)) {
      const resultValue = simulationResponse.result.retval;
      const rawBalance = StellarSdk.scValToNative(resultValue);
      return rawBalance.toString();
    } else {
      return '0';
    }
  } catch (error) {
    console.error('Error fetching token balance:', error);
    return '0';
  }
}

/**
 * Get token metadata (name, symbol, decimals) using SEP-41
 * Uses localStorage cache since metadata never changes
 * @param {string} tokenContractId - The token contract ID
 * @param {object} deps - Dependencies
 * @returns {Promise<{name: string, symbol: string, decimals: number}>}
 */
export async function getTokenMetadata(tokenContractId, { rpcServer } = {}) {
  const network = config.stellar.network;
  const cached = storageManager.getCachedMetadata(tokenContractId, network);
  if (cached) {
    return cached;
  }

  rpcServer = rpcServer || createScanRpcServer();

  const placeholderKeypair = StellarSdk.Keypair.random();
  const placeholderAccount = new StellarSdk.Account(placeholderKeypair.publicKey(), '0');
  const contract = new StellarSdk.Contract(tokenContractId);

  const result = { name: 'Unknown', symbol: null, decimals: 7 };

  // Get symbol (required)
  const symbolTx = new StellarSdk.TransactionBuilder(placeholderAccount, {
    fee: '10000',
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(contract.call('symbol'))
    .setTimeout(30)
    .build();

  const symbolResponse = await rpcServer.simulateTransaction(symbolTx);
  if (!StellarSdk.rpc.Api.isSimulationSuccess(symbolResponse)) {
    const errorMsg = symbolResponse.error || '';
    if (errorMsg.includes('MissingValue') || errorMsg.includes('not found')) {
      throw new Error('Contract not found or not deployed');
    }
    throw new Error('Contract is not SEP-41 compliant (no symbol function)');
  }
  result.symbol = StellarSdk.scValToNative(symbolResponse.result.retval);

  // Try to get name (optional)
  try {
    const nameTx = new StellarSdk.TransactionBuilder(placeholderAccount, {
      fee: '10000',
      networkPassphrase: config.networkPassphrase
    })
      .addOperation(contract.call('name'))
      .setTimeout(30)
      .build();

    const nameResponse = await rpcServer.simulateTransaction(nameTx);
    if (StellarSdk.rpc.Api.isSimulationSuccess(nameResponse)) {
      result.name = StellarSdk.scValToNative(nameResponse.result.retval);
    }
  } catch (e) {
    // Name is optional
  }

  // Try to get decimals (optional)
  try {
    const decimalsTx = new StellarSdk.TransactionBuilder(placeholderAccount, {
      fee: '10000',
      networkPassphrase: config.networkPassphrase
    })
      .addOperation(contract.call('decimals'))
      .setTimeout(30)
      .build();

    const decimalsResponse = await rpcServer.simulateTransaction(decimalsTx);
    if (StellarSdk.rpc.Api.isSimulationSuccess(decimalsResponse)) {
      result.decimals = Number(StellarSdk.scValToNative(decimalsResponse.result.retval));
    }
  } catch (e) {
    // Decimals is optional
  }

  storageManager.setCachedMetadata(tokenContractId, result, network);

  return result;
}

// ============================================
// Account Activity
// ============================================

/**
 * Get recent token activity for an address (any token)
 * Uses cap67db for mainnet, falls back to RPC for testnet or on failure
 * @param {string} address - Address to fetch activity for
 * @param {number} limit - Maximum events to return (default 200)
 * @returns {Promise<Array>} Array of parsed token events
 */
export async function getRecentTransfers(address, limit = 200) {
  // Try cap67db for mainnet
  if (!config.isTestnet) {
    try {
      const activity = await cap67db.getAddressActivity(address, limit);
      if (activity.length > 0) {
        return activity;
      }
      // Empty result - fall through to RPC (cap67db might not have data yet)
    } catch (error) {
      console.warn('cap67db failed, falling back to RPC:', error.message);
    }
  }

  // Fallback to RPC
  try {
    const startLedger = await getLatestLedger();
    const filter = buildTokenEventFilters(address);

    const result = await rpcCall('getEvents', {
      startLedger: startLedger,
      filters: [filter],
      pagination: { limit: limit * 5, order: 'desc' }
    });

    const events = result.events || [];

    const uniqueById = new Map();
    for (const event of events) {
      if (uniqueById.has(event.id)) continue;
      const parsed = parseTokenEvent(event, address);
      if (parsed) {
        uniqueById.set(event.id, parsed);
      }
    }

    const activity = [...uniqueById.values()];
    activity.sort((a, b) => b.ledger - a.ledger);

    return activity.slice(0, limit);
  } catch (error) {
    console.warn('Error fetching transfer history:', error);
    throw error;
  }
}

/**
 * Get unified account activity (transfers, mint, burn, clawback + fees)
 * Uses cap67db for mainnet, falls back to RPC for testnet or on failure
 * @param {string} address - Address to fetch activity for
 * @param {number} limit - Maximum events to return (default 200)
 * @returns {Promise<{activity: Array, tokenEventsFailed: boolean}>} Activity and partial failure flag
 */
export async function getAccountActivity(address, limit = 200) {
  // Try cap67db for mainnet
  if (!config.isTestnet) {
    try {
      const activity = await cap67db.getAddressActivityWithFees(address, limit);
      // cap67db returns combined results, no partial failures
      return { activity, tokenEventsFailed: false };
    } catch (error) {
      console.warn('cap67db failed, falling back to RPC:', error.message);
    }
  }

  // Fallback to RPC
  try {
    const xlmContractId = StellarSdk.Asset.native().contractId(config.networkPassphrase);
    const startLedger = await getLatestLedger();

    const tokenFilter = buildTokenEventFilters(address);
    const feeFilter = buildFeeEventFilters(address, xlmContractId);

    // Two parallel queries - use allSettled so partial failures still return data
    const [tokenResult, feeResult] = await Promise.allSettled([
      rpcCall('getEvents', {
        startLedger: startLedger,
        filters: [tokenFilter],
        pagination: { limit, order: 'desc' }
      }),
      rpcCall('getEvents', {
        startLedger: startLedger,
        filters: [feeFilter],
        pagination: { limit, order: 'desc' }
      }),
    ]);

    // Extract events from successful results
    const tokenEvents = tokenResult.status === 'fulfilled' ? (tokenResult.value.events || []) : [];
    const feeEvents = feeResult.status === 'fulfilled' ? (feeResult.value.events || []) : [];
    const tokenEventsFailed = tokenResult.status === 'rejected';

    // If both failed, throw the token error (more relevant to user)
    if (tokenResult.status === 'rejected' && feeResult.status === 'rejected') {
      throw tokenResult.reason;
    }

    const allEvents = [...tokenEvents, ...feeEvents];

    const uniqueById = new Map();
    for (const event of allEvents) {
      if (uniqueById.has(event.id)) continue;

      const firstTopic = event.topic?.[0];
      if (!firstTopic) continue;

      try {
        const symbol = StellarSdk.scValToNative(StellarSdk.xdr.ScVal.fromXDR(firstTopic, 'base64'));
        if (symbol === 'fee') {
          uniqueById.set(event.id, parseFeeEvent(event, address));
        } else {
          const parsed = parseTokenEvent(event, address);
          if (parsed) {
            uniqueById.set(event.id, parsed);
          }
        }
      } catch {
        // Skip events we can't parse
      }
    }

    const activity = [...uniqueById.values()];
    activity.sort((a, b) => b.ledger - a.ledger);

    return { activity: activity.slice(0, limit), tokenEventsFailed };
  } catch (error) {
    console.error('Error fetching account activity:', error);
    throw error;
  }
}

/**
 * Get fee events for an address (CAP-67)
 * Uses cap67db for mainnet, falls back to RPC for testnet or on failure
 * @param {string} address - Address to fetch fee events for
 * @param {number} limit - Maximum events to return (default 200)
 * @returns {Promise<Array>} Array of parsed fee events
 */
export async function getFeeEvents(address, limit = 200) {
  // Try cap67db for mainnet
  if (!config.isTestnet) {
    try {
      return await cap67db.getAddressFeeEvents(address, limit);
    } catch (error) {
      console.warn('cap67db failed, falling back to RPC:', error.message);
    }
  }

  // Fallback to RPC
  try {
    const xlmContractId = StellarSdk.Asset.native().contractId(config.networkPassphrase);
    const startLedger = await getLatestLedger();
    const filter = buildFeeEventFilters(address, xlmContractId);

    const result = await rpcCall('getEvents', {
      startLedger: startLedger,
      filters: [filter],
      pagination: { limit: limit, order: 'desc' }
    });

    const events = result.events || [];
    return events.map(event => parseFeeEvent(event, address));
  } catch (error) {
    console.error('Error fetching fee events:', error);
    throw error;
  }
}

// ============================================
// Token Activity
// ============================================

/**
 * Get recent token activity across all contracts (network-wide)
 * Uses cap67db for mainnet, falls back to RPC for testnet or on failure
 * @param {number} limit - Maximum events to return (default 50)
 * @returns {Promise<Array>} Array of parsed token events
 */
export async function getRecentTokenActivity(limit = 50) {
  // Try cap67db for mainnet
  if (!config.isTestnet) {
    try {
      return await cap67db.getNetworkActivity(limit);
    } catch (error) {
      console.warn('cap67db failed, falling back to RPC:', error.message);
    }
  }

  // Fallback to RPC
  const startLedger = await getLatestLedger();

  const parseEvents = (events) => {
    const uniqueById = new Map();
    for (const event of events) {
      if (uniqueById.has(event.id)) continue;
      const parsed = parseTokenEvent(event);
      if (parsed) {
        uniqueById.set(event.id, parsed);
      }
    }
    const activity = [...uniqueById.values()];
    activity.sort((a, b) => b.ledger - a.ledger);
    return activity.slice(0, limit);
  };

  try {
    const filter = buildNetworkActivityFilters();
    const result = await rpcCall('getEvents', {
      startLedger: startLedger,
      filters: [filter],
      pagination: { limit: limit * 4, order: 'desc' }
    });
    return parseEvents(result.events || []);
  } catch (error) {
    if (error.code === -32001) {
      console.warn('Combined query hit RPC limits, falling back to transfers only');
      try {
        const filter = buildTransfersOnlyFilters();
        const result = await rpcCall('getEvents', {
          startLedger: startLedger,
          filters: [filter],
          pagination: { limit, order: 'desc' }
        });
        return parseEvents(result.events || []);
      } catch (fallbackError) {
        console.error('Fallback query also failed:', fallbackError);
        throw fallbackError;
      }
    }
    console.error('Error fetching recent token activity:', error);
    throw error;
  }
}

/**
 * Get recent activity for a specific token contract
 * Uses cap67db for mainnet, falls back to RPC for testnet or on failure
 * @param {string} tokenContractId - Token contract ID
 * @param {number} limit - Maximum events to return (default 200)
 * @returns {Promise<Array>} Array of parsed token events
 */
export async function getTokenTransfers(tokenContractId, limit = 200) {
  // Try cap67db for mainnet
  if (!config.isTestnet) {
    try {
      const activity = await cap67db.getContractActivity(tokenContractId, limit);
      if (activity.length > 0) {
        return activity;
      }
      // Empty result - fall through to RPC (cap67db might not have data yet)
    } catch (error) {
      console.warn('cap67db failed, falling back to RPC:', error.message);
    }
  }

  // Fallback to RPC
  try {
    const startLedger = await getLatestLedger();
    const filter = buildTokenActivityFilters(tokenContractId);

    const result = await rpcCall('getEvents', {
      startLedger: startLedger,
      filters: [filter],
      pagination: { limit: limit * 4, order: 'desc' }
    });

    const events = result.events || [];

    const uniqueById = new Map();
    for (const event of events) {
      if (uniqueById.has(event.id)) continue;
      const parsed = parseTokenEvent(event);
      if (parsed) {
        uniqueById.set(event.id, parsed);
      }
    }

    const activity = [...uniqueById.values()];
    activity.sort((a, b) => b.ledger - a.ledger);

    return activity.slice(0, limit);
  } catch (error) {
    console.error('Error fetching token transfers:', error);
    throw error;
  }
}

// ============================================
// Contract Activity
// ============================================

/**
 * Get recent invocations for a contract
 * @param {string} contractId - Contract ID
 * @param {number} limit - Maximum events to return (default 200)
 * @returns {Promise<Array>} Array of parsed invocation events
 */
export async function getContractInvocations(contractId, limit = 200) {
  try {
    const startLedger = await getLatestLedger();

    const result = await rpcCall('getEvents', {
      startLedger: startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [contractId],
        }
      ],
      pagination: { limit: limit, order: 'desc' }
    });

    const events = result.events || [];
    return events.map(event => parseContractEvent(event));
  } catch (error) {
    console.error('Error fetching contract invocations:', error);
    throw error;
  }
}

// ============================================
// Transaction
// ============================================

/**
 * Get transaction details from RPC with failover to public RPC
 * Falls back to public RPC on error OR if primary returns NOT_FOUND
 * (since the primary RPC may have a shorter retention window)
 * @param {string} txHash - The transaction hash
 * @returns {Promise<object>} Transaction data
 */
export async function getTransaction(txHash) {
  const rpcOptions = {
    timeoutMs: config.rpc.timeoutMs,
    maxRetries: config.rpc.maxRetries,
    backoffMs: config.rpc.backoffMs,
    backoffMaxMs: config.rpc.backoffMaxMs,
  };

  let result;
  try {
    result = await rpcCallBase(config.stellar.sorobanRpcUrl, 'getTransaction', { hash: txHash }, rpcOptions);
  } catch (error) {
    console.warn('Primary RPC failed for getTransaction, trying public RPC:', error.message);
    result = await rpcCallBase(config.stellar.sorobanRpcUrlPublic, 'getTransaction', { hash: txHash }, rpcOptions);
  }

  // If primary returned NOT_FOUND, try public RPC (may have longer retention)
  if (result.status === 'NOT_FOUND') {
    try {
      const publicResult = await rpcCallBase(config.stellar.sorobanRpcUrlPublic, 'getTransaction', { hash: txHash }, rpcOptions);
      if (publicResult.status !== 'NOT_FOUND') {
        result = publicResult;
      }
    } catch (error) {
      console.warn('Public RPC fallback failed:', error.message);
      // Keep the original NOT_FOUND result
    }
  }

  if (result.status === 'NOT_FOUND') {
    return {
      status: 'NOT_FOUND',
      hash: txHash,
    };
  }

  return {
    status: result.status,
    hash: txHash,
    ledger: result.ledger,
    createdAt: result.createdAt,
    applicationOrder: result.applicationOrder,
    feeBump: result.feeBump,
    envelopeXdr: result.envelopeXdr,
    resultXdr: result.resultXdr,
    resultMetaXdr: result.resultMetaXdr,
  };
}

// ============================================
// XDR Decoding
// ============================================

/**
 * Initialize the XDR decoder WASM module
 * @returns {Promise<void>}
 */
export async function initXdrDecoder() {
  if (xdrDecoderReady) return;

  try {
    const module = await import('@stellar/stellar-xdr-json');
    await module.default();
    xdrDecoderModule = module;
    xdrDecoderReady = true;
  } catch (error) {
    console.error('Failed to initialize XDR decoder:', error);
    throw error;
  }
}

/**
 * Decode XDR to JSON using the stellar-xdr-json library
 * @param {string} typeName - The XDR type name
 * @param {string} xdrBase64 - The base64-encoded XDR
 * @returns {Promise<object>} The decoded JSON object
 */
export async function decodeXdr(typeName, xdrBase64) {
  if (!xdrDecoderReady) {
    await initXdrDecoder();
  }

  try {
    const jsonString = xdrDecoderModule.decode(typeName, xdrBase64);
    return JSON.parse(jsonString);
  } catch (error) {
    console.error(`Failed to decode XDR type ${typeName}:`, error);
    throw error;
  }
}

// ============================================
// Liquidity Pools
// ============================================

/**
 * Parse an Asset XDR into a readable format
 * @param {object} asset - The XDR Asset object
 * @returns {object} Parsed asset info
 */
function parseAssetXdr(asset) {
  const assetType = asset.switch().name;

  if (assetType === 'assetTypeNative') {
    return { code: 'XLM', issuer: null, isNative: true };
  }

  if (assetType === 'assetTypeCreditAlphanum4') {
    const alphaNum4 = asset.alphaNum4();
    return {
      code: alphaNum4.assetCode().toString().replace(/\0+$/, ''),
      issuer: StellarSdk.StrKey.encodeEd25519PublicKey(alphaNum4.issuer().ed25519()),
      isNative: false,
    };
  }

  if (assetType === 'assetTypeCreditAlphanum12') {
    const alphaNum12 = asset.alphaNum12();
    return {
      code: alphaNum12.assetCode().toString().replace(/\0+$/, ''),
      issuer: StellarSdk.StrKey.encodeEd25519PublicKey(alphaNum12.issuer().ed25519()),
      isNative: false,
    };
  }

  return { code: 'UNKNOWN', issuer: null, isNative: false };
}

/**
 * Get the contract ID for a classic Stellar asset (SAC)
 * @param {object} assetInfo - Asset info with code and issuer
 * @returns {string} The contract ID
 */
function getAssetContractId(assetInfo) {
  if (assetInfo.isNative) {
    return StellarSdk.Asset.native().contractId(config.networkPassphrase);
  }
  const asset = new StellarSdk.Asset(assetInfo.code, assetInfo.issuer);
  return asset.contractId(config.networkPassphrase);
}

/**
 * Try to get pool share token metadata for a contract ID
 * @param {string} contractId - The C... contract address
 * @returns {Promise<object|null>} Pool share metadata or null
 */
export async function getPoolShareMetadata(contractId) {
  if (!contractId || !contractId.startsWith('C')) {
    return null;
  }

  try {
    const rawId = StellarSdk.StrKey.decodeContract(contractId);
    const poolAddress = StellarSdk.StrKey.encodeLiquidityPool(rawId);
    const poolData = await getLiquidityPoolData(poolAddress);

    if (!poolData) {
      return null;
    }

    const symbol = `${poolData.assetA.code}:${poolData.assetB.code}`;

    return {
      symbol,
      decimals: 7,
      isPoolShare: true,
      poolAddress,
      assetA: poolData.assetA.code,
      assetB: poolData.assetB.code,
    };
  } catch {
    return null;
  }
}

/**
 * Get liquidity pool data from RPC
 * @param {string} poolAddress - The L... address
 * @returns {Promise<object>} Pool data
 */
export async function getLiquidityPoolData(poolAddress) {
  if (!poolAddress || !poolAddress.startsWith('L')) {
    throw new Error('Invalid liquidity pool address - must start with L');
  }

  try {
    const poolIdBuffer = StellarSdk.StrKey.decodeLiquidityPool(poolAddress);
    const poolIdXdr = StellarSdk.xdr.PoolId.fromXDR(poolIdBuffer);
    const ledgerKey = StellarSdk.xdr.LedgerKey.liquidityPool(
      new StellarSdk.xdr.LedgerKeyLiquidityPool({ liquidityPoolId: poolIdXdr })
    );

    const keyBase64 = ledgerKey.toXDR('base64');
    const result = await rpcCall('getLedgerEntries', { keys: [keyBase64] });

    if (!result.entries || result.entries.length === 0) {
      return null;
    }

    const entryXdr = result.entries[0].xdr;
    const ledgerEntry = StellarSdk.xdr.LedgerEntryData.fromXDR(entryXdr, 'base64');
    const lpEntry = ledgerEntry.liquidityPool();
    const body = lpEntry.body();
    const cp = body.constantProduct();
    const params = cp.params();

    const assetA = parseAssetXdr(params.assetA());
    const assetB = parseAssetXdr(params.assetB());

    const assetAContractId = getAssetContractId(assetA);
    const assetBContractId = getAssetContractId(assetB);

    return {
      poolId: poolAddress,
      assetA: {
        ...assetA,
        contractId: assetAContractId,
        reserve: cp.reserveA().toString(),
      },
      assetB: {
        ...assetB,
        contractId: assetBContractId,
        reserve: cp.reserveB().toString(),
      },
      fee: params.fee(),
      totalPoolShares: cp.totalPoolShares().toString(),
      trustlineCount: cp.poolSharesTrustLineCount().toString(),
      latestLedger: result.latestLedger,
    };
  } catch (error) {
    console.warn('Error fetching liquidity pool data:', error);
    throw error;
  }
}

// ============================================
// Backward Compatibility Exports
// ============================================

/**
 * Get cached token metadata (backward compatible)
 * @param {string} contractId - Token contract ID
 * @returns {object|null} Cached metadata or null
 */
export function getCachedMetadata(contractId) {
  const network = config.stellar.network;
  return storageManager.getCachedMetadata(contractId, network);
}

/**
 * Cache SAC metadata (backward compatible)
 * @param {string} contractId - Token contract ID
 * @param {string} sacSymbol - Symbol
 * @param {string} sacFullName - Full name
 */
export function cacheSacMetadata(contractId, sacSymbol, sacFullName) {
  const network = config.stellar.network;
  storageManager.cacheSacMetadata(contractId, sacSymbol, sacFullName, network);
}

/**
 * Get tracked assets (backward compatible)
 * @returns {Array} Tracked assets
 */
export function getTrackedAssets() {
  const network = config.stellar.network;
  return storageManager.getTrackedAssets(network);
}

/**
 * Add tracked asset (backward compatible)
 * @param {string} contractId - Contract ID
 * @param {string} symbol - Symbol
 * @param {string} name - Name
 */
export function addTrackedAsset(contractId, symbol, name) {
  const network = config.stellar.network;
  storageManager.addTrackedAsset(contractId, symbol, name, network);
}

/**
 * Remove tracked asset (backward compatible)
 * @param {string} contractId - Contract ID
 */
export function removeTrackedAsset(contractId) {
  const network = config.stellar.network;
  storageManager.removeTrackedAsset(contractId, network);
}

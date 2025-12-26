/**
 * Lumenitos Scan utilities
 * Functions for the block explorer feature
 */

import * as StellarSdk from '@stellar/stellar-sdk';

// Re-export helpers for convenient imports
export * from './helpers';
export * from './operations';
import config from '../config';
import { scValToAddress, scValToAmount } from '../stellar/helpers';

// XDR decoder state (lazy loaded WASM)
let xdrDecoderModule = null;
let xdrDecoderReady = false;

/**
 * Create an RPC server for scan operations
 * Uses the shared RPC URL from config
 */
function createScanRpcServer() {
  return new StellarSdk.rpc.Server(config.stellar.sorobanRpcUrl);
}

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

    // Build a transaction to simulate the balance() call
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
      // Return raw balance as string (BigInt converted to string)
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
 * @throws {Error} If the contract doesn't exist or is not SEP-41 compliant
 */
export async function getTokenMetadata(tokenContractId, { rpcServer } = {}) {
  // Check cache first
  const cached = getCachedMetadata(tokenContractId);
  if (cached) {
    return cached;
  }

  rpcServer = rpcServer || createScanRpcServer();

  const placeholderKeypair = StellarSdk.Keypair.random();
  const placeholderAccount = new StellarSdk.Account(placeholderKeypair.publicKey(), '0');
  const contract = new StellarSdk.Contract(tokenContractId);

  const result = { name: 'Unknown', symbol: null, decimals: 7 };

  // Get symbol (required - if this fails, the contract doesn't exist or isn't SEP-41)
  const symbolTx = new StellarSdk.TransactionBuilder(placeholderAccount, {
    fee: '10000',
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(contract.call('symbol'))
    .setTimeout(30)
    .build();

  const symbolResponse = await rpcServer.simulateTransaction(symbolTx);
  if (!StellarSdk.rpc.Api.isSimulationSuccess(symbolResponse)) {
    // Check if it's a "contract not found" error
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
    // Name is optional, ignore errors
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
    // Decimals is optional, ignore errors
  }

  // Cache the result
  setCachedMetadata(tokenContractId, result);

  return result;
}

/**
 * Parse a transfer event into structured format
 * @param {object} event - The event from getEvents
 * @param {string} targetAddress - Address we're tracking
 * @returns {object} Parsed transfer info
 */
function parseTransferEvent(event, targetAddress) {
  // Parse topic ScVals from base64
  const topics = (event.topic || []).map(topicXdr => {
    try {
      return StellarSdk.xdr.ScVal.fromXDR(topicXdr, 'base64');
    } catch {
      return null;
    }
  });

  let from = 'unknown';
  let to = 'unknown';
  let amount = 0n;

  if (topics.length >= 2 && topics[1]) {
    from = scValToAddress(topics[1]);
  }
  if (topics.length >= 3 && topics[2]) {
    to = scValToAddress(topics[2]);
  }
  if (event.value) {
    try {
      const valueScVal = StellarSdk.xdr.ScVal.fromXDR(event.value, 'base64');
      amount = scValToAmount(valueScVal);
    } catch {
      amount = 0n;
    }
  }

  const direction = from === targetAddress ? 'sent' : 'received';

  return {
    txHash: event.txHash,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
    contractId: event.contractId,
    from,
    to,
    amount,
    direction,
    counterparty: direction === 'sent' ? to : from
  };
}

/**
 * Make a direct JSON-RPC call to the RPC server
 * This bypasses the SDK to use the new order parameter
 * @param {string} method - RPC method name
 * @param {object} params - RPC parameters
 * @returns {Promise<object>} RPC result
 */
async function rpcCall(method, params) {
  const response = await fetch(config.stellar.sorobanRpcUrl, {
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
    throw new Error(`RPC error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return data.result;
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
 * Get recent transfers for an address (any token)
 * Fetches SEP-41 transfer events without contract filtering
 * Uses separate queries for sent/received to avoid RPC processing limits
 * @param {string} address - Address to fetch transfers for
 * @param {number} limit - Maximum transfers to return (default 200)
 * @returns {Promise<Array>} Array of parsed transfers
 */
export async function getRecentTransfers(address, limit = 200) {
  try {
    const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
    const targetScVal = StellarSdk.nativeToScVal(StellarSdk.Address.fromString(address), {
      type: 'address',
    });

    const startLedger = await getLatestLedger();

    // Split into separate queries to avoid RPC processing limit errors
    const [sentResult, receivedResult] = await Promise.all([
      // transfers FROM the address
      rpcCall('getEvents', {
        startLedger: startLedger,
        filters: [{
          type: 'contract',
          topics: [[transferSymbol.toXDR('base64'), targetScVal.toXDR('base64'), '*', '**']],
        }],
        pagination: { limit: limit, order: 'desc' }
      }),
      // transfers TO the address
      rpcCall('getEvents', {
        startLedger: startLedger,
        filters: [{
          type: 'contract',
          topics: [[transferSymbol.toXDR('base64'), '*', targetScVal.toXDR('base64'), '**']],
        }],
        pagination: { limit: limit, order: 'desc' }
      })
    ]);

    const sentEvents = (sentResult.events || []).map(e => parseTransferEvent(e, address));
    const receivedEvents = (receivedResult.events || []).map(e => parseTransferEvent(e, address));

    // Merge and sort by ledger descending
    const combined = [...sentEvents, ...receivedEvents];
    combined.sort((a, b) => b.ledger - a.ledger);

    return combined.slice(0, limit);
  } catch (error) {
    console.error('Error fetching transfer history:', error);
    throw error;
  }
}

/**
 * Extract unique contract IDs from transfers
 * @param {Array} transfers - Array of parsed transfers
 * @returns {string[]} Array of unique contract IDs
 */
export function extractContractIds(transfers) {
  const contractIds = new Set();
  for (const t of transfers) {
    if (t.contractId) {
      contractIds.add(t.contractId);
    }
  }
  return Array.from(contractIds);
}

/**
 * Get fee events for an address (CAP-67)
 * Fee events track XLM charged/refunded for transaction fees
 * Format: topics: ["fee", from:Address], data: amount:i128
 * Positive amount = fee charged, negative amount = fee refunded
 * @param {string} address - Address to fetch fee events for
 * @param {number} limit - Maximum events to return (default 1000)
 * @returns {Promise<Array>} Array of parsed fee events
 */
export async function getFeeEvents(address, limit = 1000) {
  try {
    const feeSymbol = StellarSdk.nativeToScVal('fee', { type: 'symbol' });
    const targetScVal = StellarSdk.nativeToScVal(StellarSdk.Address.fromString(address), {
      type: 'address',
    });

    // Get the native XLM contract ID
    const xlmContractId = StellarSdk.Asset.native().contractId(config.networkPassphrase);

    const startLedger = await getLatestLedger();

    // Query for fee events (refunds are indicated by negative amounts)
    // Topics: [Symbol("fee"), Address(source_account)]
    // Format: [[topic0, topic1]] - one TopicFilter with positional matching
    const result = await rpcCall('getEvents', {
      startLedger: startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [xlmContractId],
          topics: [[feeSymbol.toXDR('base64'), targetScVal.toXDR('base64')]],
        }
      ],
      pagination: {
        limit: limit,
        order: 'desc'
      }
    });

    const events = result.events || [];
    return events.map(event => parseFeeEvent(event, address));
  } catch (error) {
    console.error('Error fetching fee events:', error);
    throw error;
  }
}

/**
 * Parse a fee event into structured format (CAP-67)
 * Positive amount = fee charged, negative amount = fee refunded
 * @param {object} event - The event from getEvents
 * @param {string} address - The address paying/receiving fees
 * @returns {object} Parsed fee event info
 */
function parseFeeEvent(event, address) {
  let amount = 0n;

  if (event.value) {
    try {
      const valueScVal = StellarSdk.xdr.ScVal.fromXDR(event.value, 'base64');
      amount = scValToAmount(valueScVal);
    } catch {
      amount = 0n;
    }
  }

  // Negative amount = refund (per CAP-67 spec)
  const isRefund = amount < 0n;

  return {
    txHash: event.txHash,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
    contractId: event.contractId,
    from: address,
    amount: isRefund ? -amount : amount, // Store absolute value
    isRefund,
    type: 'fee',
  };
}

/**
 * Get unified account activity (transfers + fees)
 * Combines SEP-41 transfer events and CAP-67 fee events
 * Uses separate queries to avoid RPC processing limit errors
 * @param {string} address - Address to fetch activity for
 * @param {number} limit - Maximum events to return (default 200)
 * @returns {Promise<Array>} Array of parsed activity items, sorted by timestamp desc
 */
export async function getAccountActivity(address, limit = 200) {
  try {
    // Fetch transfers and fees in parallel with separate queries
    // This avoids the RPC "processing limit threshold" error from combining 3 filters
    const [transfers, fees] = await Promise.all([
      getRecentTransfers(address, limit),
      getFeeEvents(address, limit),
    ]);

    // Merge and sort by ledger (descending)
    const combined = [...transfers, ...fees];
    combined.sort((a, b) => b.ledger - a.ledger);

    return combined.slice(0, limit);
  } catch (error) {
    console.error('Error fetching account activity:', error);
    throw error;
  }
}

/**
 * Get recent token activity across all contracts (network-wide)
 * Fetches SEP-41 transfer events without filtering by contract or address
 * @param {number} limit - Maximum transfers to return (default 50)
 * @returns {Promise<Array>} Array of parsed transfers
 */
export async function getRecentTokenActivity(limit = 50) {
  try {
    const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
    const startLedger = await getLatestLedger();

    // Fetch all transfer events across any contract
    const result = await rpcCall('getEvents', {
      startLedger: startLedger,
      filters: [
        {
          type: 'contract',
          topics: [[transferSymbol.toXDR('base64'), '*', '*', '**']],
        }
      ],
      pagination: {
        limit: limit,
        order: 'desc'
      }
    });

    const events = result.events || [];
    return events.map(event => parseTransferEventGeneric(event));
  } catch (error) {
    console.error('Error fetching recent token activity:', error);
    throw error;
  }
}

/**
 * Get recent transfers for a specific token contract
 * Fetches SEP-41 transfer events for a specific contract
 * Supports both 4-topic events (transfer, from, to, amount) and 3-topic events (transfer, from, to)
 * @param {string} tokenContractId - Token contract ID to fetch transfers for
 * @param {number} limit - Maximum transfers to return (default 1000)
 * @returns {Promise<Array>} Array of parsed transfers
 */
export async function getTokenTransfers(tokenContractId, limit = 1000) {
  try {
    const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
    const startLedger = await getLatestLedger();

    // Filter for all transfer events from this specific contract
    // Use ** for 4th topic to match both 3-topic and 4-topic events
    const result = await rpcCall('getEvents', {
      startLedger: startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [tokenContractId],
          topics: [[transferSymbol.toXDR('base64'), '*', '*', '**']],
        }
      ],
      pagination: {
        limit: limit,
        order: 'desc'
      }
    });

    const events = result.events || [];
    // Parse events without a target address (shows all transfers)
    return events.map(event => parseTransferEventGeneric(event));
  } catch (error) {
    console.error('Error fetching token transfers:', error);
    throw error;
  }
}

/**
 * Parse a transfer event into structured format (generic, no target address)
 * @param {object} event - The event from getEvents
 * @returns {object} Parsed transfer info
 */
function parseTransferEventGeneric(event) {
  const topics = (event.topic || []).map(topicXdr => {
    try {
      return StellarSdk.xdr.ScVal.fromXDR(topicXdr, 'base64');
    } catch {
      return null;
    }
  });

  let from = 'unknown';
  let to = 'unknown';
  let amount = 0n;

  if (topics.length >= 2 && topics[1]) {
    from = scValToAddress(topics[1]);
  }
  if (topics.length >= 3 && topics[2]) {
    to = scValToAddress(topics[2]);
  }
  if (event.value) {
    try {
      const valueScVal = StellarSdk.xdr.ScVal.fromXDR(event.value, 'base64');
      amount = scValToAmount(valueScVal);
    } catch {
      amount = 0n;
    }
  }

  return {
    txHash: event.txHash,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
    contractId: event.contractId,
    from,
    to,
    amount
  };
}

/**
 * Validate if a string is a valid Stellar address (G..., C..., or L...)
 * @param {string} address - The address to validate
 * @returns {boolean} Whether the address is valid
 */
export function isValidAddress(address) {
  if (!address || typeof address !== 'string') {
    return false;
  }
  try {
    if (address.startsWith('G')) {
      StellarSdk.StrKey.decodeEd25519PublicKey(address);
      return true;
    }
    if (address.startsWith('C')) {
      StellarSdk.StrKey.decodeContract(address);
      return true;
    }
    if (address.startsWith('L')) {
      // Liquidity pool address - decodes to pool ID
      const poolId = StellarSdk.StrKey.decodeLiquidityPool(address);
      return poolId && poolId.length === 32;
    }
    return false;
  } catch {
    return false;
  }
}

// LocalStorage keys for scan
const SCAN_STORAGE_KEYS = {
  trackedAssets: 'scan_tracked_assets',
  tokenMetadataCache: 'scan_token_metadata_cache',
};

/**
 * Get the cache key for token metadata (namespaced by network)
 * @returns {string} Cache key
 */
function getMetadataCacheKey() {
  const network = config.stellar.network;
  return `${SCAN_STORAGE_KEYS.tokenMetadataCache}_${network}`;
}

/**
 * Get cached token metadata from localStorage
 * @param {string} contractId - Token contract ID
 * @returns {object|null} Cached metadata or null
 */
function getCachedMetadata(contractId) {
  if (typeof window === 'undefined') return null;
  try {
    const cacheKey = getMetadataCacheKey();
    const cache = localStorage.getItem(cacheKey);
    if (!cache) return null;
    const parsed = JSON.parse(cache);
    return parsed[contractId] || null;
  } catch {
    return null;
  }
}

/**
 * Store token metadata in localStorage cache
 * @param {string} contractId - Token contract ID
 * @param {object} metadata - Metadata to cache
 */
function setCachedMetadata(contractId, metadata) {
  if (typeof window === 'undefined') return;
  try {
    const cacheKey = getMetadataCacheKey();
    const cache = localStorage.getItem(cacheKey);
    const parsed = cache ? JSON.parse(cache) : {};
    parsed[contractId] = metadata;
    localStorage.setItem(cacheKey, JSON.stringify(parsed));
  } catch {
    // Ignore cache errors
  }
}

/**
 * Get the storage key for tracked assets (namespaced by network)
 * @returns {string} Storage key
 */
function getTrackedAssetsKey() {
  const network = config.stellar.network;
  return `${SCAN_STORAGE_KEYS.trackedAssets}_${network}`;
}

/**
 * Get manually tracked assets from localStorage
 * @returns {Array<{contractId: string, symbol: string, name: string}>}
 */
export function getTrackedAssets() {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const key = getTrackedAssetsKey();
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Add a tracked asset to localStorage
 * @param {string} contractId - The token contract ID
 * @param {string} symbol - Token symbol
 * @param {string} name - Token name
 */
export function addTrackedAsset(contractId, symbol, name) {
  if (typeof window === 'undefined') {
    return;
  }
  const key = getTrackedAssetsKey();
  const assets = getTrackedAssets();
  if (!assets.find(a => a.contractId === contractId)) {
    assets.push({ contractId, symbol, name });
    localStorage.setItem(key, JSON.stringify(assets));
  }
}

/**
 * Remove a tracked asset from localStorage
 * @param {string} contractId - The token contract ID to remove
 */
export function removeTrackedAsset(contractId) {
  if (typeof window === 'undefined') {
    return;
  }
  const key = getTrackedAssetsKey();
  const assets = getTrackedAssets().filter(a => a.contractId !== contractId);
  localStorage.setItem(key, JSON.stringify(assets));
}

/**
 * Initialize the XDR decoder WASM module
 * Must be called before using decodeXdr
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
 * @param {string} typeName - The XDR type name (e.g., 'TransactionEnvelope')
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

/**
 * Get recent invocations for a contract
 * Fetches all events (any type) from a specific contract
 * @param {string} contractId - Contract ID to fetch invocations for
 * @param {number} limit - Maximum events to return (default 100)
 * @returns {Promise<Array>} Array of parsed invocation events
 */
export async function getContractInvocations(contractId, limit = 100) {
  try {
    const startLedger = await getLatestLedger();

    // Fetch all events from this contract (no topic filter = all events)
    const result = await rpcCall('getEvents', {
      startLedger: startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [contractId],
        }
      ],
      pagination: {
        limit: limit,
        order: 'desc'
      }
    });

    const events = result.events || [];
    return events.map(event => parseContractEvent(event));
  } catch (error) {
    console.error('Error fetching contract invocations:', error);
    throw error;
  }
}

/**
 * Parse a contract event into structured format
 * @param {object} event - The event from getEvents
 * @returns {object} Parsed event info
 */
function parseContractEvent(event) {
  // Parse topic ScVals from base64 to get the event type
  const topics = (event.topic || []).map(topicXdr => {
    try {
      const scVal = StellarSdk.xdr.ScVal.fromXDR(topicXdr, 'base64');
      // Try to convert to native value for display
      try {
        return StellarSdk.scValToNative(scVal);
      } catch {
        // For addresses, use our helper
        if (scVal.switch().name === 'scvAddress') {
          return scValToAddress(scVal);
        }
        return scVal.switch().name;
      }
    } catch {
      return null;
    }
  });

  // Get the event type (first topic, usually a symbol)
  const eventType = topics[0] || 'unknown';

  // Parse value if present
  let value = null;
  if (event.value) {
    try {
      const valueScVal = StellarSdk.xdr.ScVal.fromXDR(event.value, 'base64');
      try {
        value = StellarSdk.scValToNative(valueScVal);
      } catch {
        value = valueScVal.switch().name;
      }
    } catch {
      value = null;
    }
  }

  return {
    txHash: event.txHash,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
    contractId: event.contractId,
    type: event.type,
    eventType: typeof eventType === 'string' ? eventType : String(eventType),
    topics: topics.slice(1), // Exclude first topic (event name)
    value,
    inSuccessfulContractCall: event.inSuccessfulContractCall,
  };
}

/**
 * Get transaction details from RPC
 * @param {string} txHash - The transaction hash
 * @returns {Promise<object>} Transaction data including XDRs and events
 */
export async function getTransaction(txHash) {
  const result = await rpcCall('getTransaction', { hash: txHash });

  if (result.status === 'NOT_FOUND') {
    return {
      status: 'NOT_FOUND',
      hash: txHash,
    };
  }

  // Events will be extracted from decoded XDR on the client side
  // We pass the raw XDR and let the page decode it with json-xdr

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

/**
 * Parse an Asset XDR into a readable format
 * @param {object} asset - The XDR Asset object
 * @returns {object} Parsed asset info with code and issuer
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
 * @returns {string} The contract ID for the asset
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
 * Pool shares don't implement SEP-41 metadata, so we detect them by
 * checking if the contract ID corresponds to a liquidity pool
 * @param {string} contractId - The C... contract address
 * @returns {Promise<{symbol: string, decimals: number}|null>} Pool share metadata or null
 */
export async function getPoolShareMetadata(contractId) {
  if (!contractId || !contractId.startsWith('C')) {
    return null;
  }

  try {
    // Decode C... to raw 32-byte ID
    const rawId = StellarSdk.StrKey.decodeContract(contractId);
    // Re-encode as L... (liquidity pool address)
    const poolAddress = StellarSdk.StrKey.encodeLiquidityPool(rawId);

    // Try to fetch LP data - if it succeeds, this is a pool share token
    const poolData = await getLiquidityPoolData(poolAddress);

    // If pool not found, return null
    if (!poolData) {
      return null;
    }

    // Format symbol as TICKER1:TICKER2
    const symbol = `${poolData.assetA.code}:${poolData.assetB.code}`;

    return {
      symbol,
      decimals: 7, // Pool shares have 7 decimal places
      isPoolShare: true,
      poolAddress,
      assetA: poolData.assetA.code,
      assetB: poolData.assetB.code,
    };
  } catch {
    // Not a liquidity pool, return null
    return null;
  }
}

/**
 * Get liquidity pool data from RPC using getLedgerEntries
 * @param {string} poolAddress - The L... address of the liquidity pool
 * @returns {Promise<object>} Pool data including assets, reserves, fee, and shares
 */
export async function getLiquidityPoolData(poolAddress) {
  if (!poolAddress || !poolAddress.startsWith('L')) {
    throw new Error('Invalid liquidity pool address - must start with L');
  }

  try {
    // Decode L... address to 32-byte pool ID
    const poolIdBuffer = StellarSdk.StrKey.decodeLiquidityPool(poolAddress);

    // Build the LedgerKey XDR for a liquidity pool entry
    const poolIdXdr = StellarSdk.xdr.PoolId.fromXDR(poolIdBuffer);
    const ledgerKey = StellarSdk.xdr.LedgerKey.liquidityPool(
      new StellarSdk.xdr.LedgerKeyLiquidityPool({ liquidityPoolId: poolIdXdr })
    );

    // Call getLedgerEntries RPC with the XDR key
    const keyBase64 = ledgerKey.toXDR('base64');
    const result = await rpcCall('getLedgerEntries', { keys: [keyBase64] });

    if (!result.entries || result.entries.length === 0) {
      return null;
    }

    // Parse the ledger entry XDR
    const entryXdr = result.entries[0].xdr;
    const ledgerEntry = StellarSdk.xdr.LedgerEntryData.fromXDR(entryXdr, 'base64');
    const lpEntry = ledgerEntry.liquidityPool();
    const body = lpEntry.body();
    const cp = body.constantProduct();
    const params = cp.params();

    // Parse assets
    const assetA = parseAssetXdr(params.assetA());
    const assetB = parseAssetXdr(params.assetB());

    // Get contract IDs for the assets (for linking to token pages)
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
      fee: params.fee(), // Fee in basis points (30 = 0.3%)
      totalPoolShares: cp.totalPoolShares().toString(),
      trustlineCount: cp.poolSharesTrustLineCount().toString(),
      latestLedger: result.latestLedger,
    };
  } catch (error) {
    console.error('Error fetching liquidity pool data:', error);
    throw error;
  }
}

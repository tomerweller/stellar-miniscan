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

  // SAC transfers have a 4th topic with the asset in "ticker:issuer" format
  let sacSymbol = null;
  let sacName = null;
  if (topics.length >= 4 && topics[3]) {
    try {
      const assetStr = StellarSdk.scValToNative(topics[3]);
      if (typeof assetStr === 'string') {
        if (assetStr.includes(':')) {
          sacSymbol = assetStr.split(':')[0];
          sacName = assetStr;
        } else if (assetStr === 'native') {
          sacSymbol = 'XLM';
          sacName = 'native';
        }
      }
    } catch {
      // Not a string topic, ignore
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
    counterparty: direction === 'sent' ? to : from,
    sacSymbol,
    sacName,
  };
}

/**
 * Check if an ScVal is an address type
 * @param {object} scVal - The ScVal to check
 * @returns {boolean} True if the ScVal is an address
 */
function isAddressScVal(scVal) {
  if (!scVal) return false;
  try {
    return scVal.switch().name === 'scvAddress';
  } catch {
    return false;
  }
}

/**
 * Parse a CAP-67 token event (transfer, mint, burn, clawback) into structured format
 * Only returns events that conform to the CAP-67 specification with proper address topics
 * @param {object} event - The event from getEvents
 * @param {string} targetAddress - Address we're tracking (optional)
 * @returns {object|null} Parsed event info or null if unrecognized or non-conforming
 */
function parseTokenEvent(event, targetAddress = null) {
  // Parse topic ScVals from base64
  const topics = (event.topic || []).map(topicXdr => {
    try {
      return StellarSdk.xdr.ScVal.fromXDR(topicXdr, 'base64');
    } catch {
      return null;
    }
  });

  if (!topics[0]) return null;

  // Get event type from first topic
  let eventType;
  try {
    eventType = StellarSdk.scValToNative(topics[0]);
  } catch {
    return null;
  }

  let amount = 0n;
  if (event.value) {
    try {
      const valueScVal = StellarSdk.xdr.ScVal.fromXDR(event.value, 'base64');
      amount = scValToAmount(valueScVal);
    } catch {
      amount = 0n;
    }
  }

  // Extract SAC asset info from last topic if present
  let sacSymbol = null;
  let sacName = null;
  const lastTopic = topics[topics.length - 1];
  if (lastTopic) {
    try {
      const assetStr = StellarSdk.scValToNative(lastTopic);
      if (typeof assetStr === 'string') {
        if (assetStr.includes(':')) {
          sacSymbol = assetStr.split(':')[0];
          sacName = assetStr;
        } else if (assetStr === 'native') {
          sacSymbol = 'XLM';
          sacName = 'native';
        }
      }
    } catch {
      // Not a string topic, ignore
    }
  }

  const baseEvent = {
    txHash: event.txHash,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
    contractId: event.contractId,
    amount,
    sacSymbol,
    sacName,
  };

  // Parse based on event type - validate CAP-67 format with proper address topics
  // transfer: [symbol, from, to, asset?] - topics[1] and [2] must be addresses
  // mint: [symbol, admin, to, asset?] - topics[1] and [2] must be addresses
  // burn: [symbol, from, asset?] - topic[1] must be address
  // clawback: [symbol, admin, from, asset?] - topics[1] and [2] must be addresses

  if (eventType === 'transfer') {
    // Validate CAP-67 format: topics[1] and [2] must be addresses
    if (!isAddressScVal(topics[1]) || !isAddressScVal(topics[2])) {
      return null; // Non-conforming event
    }
    const from = scValToAddress(topics[1]);
    const to = scValToAddress(topics[2]);
    const direction = from === targetAddress ? 'sent' : 'received';
    return {
      ...baseEvent,
      type: 'transfer',
      from,
      to,
      direction,
      counterparty: direction === 'sent' ? to : from,
    };
  }

  if (eventType === 'mint') {
    // Validate CAP-67 format: topics[1] and [2] must be addresses
    if (!isAddressScVal(topics[1]) || !isAddressScVal(topics[2])) {
      return null; // Non-conforming event (e.g., KALE has asset string in topic[2])
    }
    const admin = scValToAddress(topics[1]);
    const to = scValToAddress(topics[2]);
    return {
      ...baseEvent,
      type: 'mint',
      from: admin, // admin who minted
      to,          // recipient
      direction: 'received',
      counterparty: admin,
    };
  }

  if (eventType === 'burn') {
    // Validate CAP-67 format: topic[1] must be address
    if (!isAddressScVal(topics[1])) {
      return null; // Non-conforming event
    }
    const from = scValToAddress(topics[1]);
    return {
      ...baseEvent,
      type: 'burn',
      from,
      to: null,    // burned, no recipient
      direction: 'sent',
      counterparty: null,
    };
  }

  if (eventType === 'clawback') {
    // Validate CAP-67 format: topics[1] and [2] must be addresses
    if (!isAddressScVal(topics[1]) || !isAddressScVal(topics[2])) {
      return null; // Non-conforming event
    }
    const admin = scValToAddress(topics[1]);
    const from = scValToAddress(topics[2]);
    return {
      ...baseEvent,
      type: 'clawback',
      from,        // account tokens were taken from
      to: admin,   // admin who clawed back
      direction: 'sent',
      counterparty: admin,
    };
  }

  return null; // Unrecognized event type
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
    // Include error code in message for specific error handling
    // -32001 = processing limit exceeded (too much data)
    const errorCode = data.error.code;
    const errorMessage = data.error.message || JSON.stringify(data.error);
    const error = new Error(`RPC error: [${errorCode}] ${errorMessage}`);
    error.code = errorCode;
    throw error;
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
 * Get recent token activity for an address (any token)
 * Fetches transfer, mint, burn, and clawback events (CAP-67)
 * Uses a single query with multiple filters for efficiency
 * @param {string} address - Address to fetch activity for
 * @param {number} limit - Maximum events to return (default 200)
 * @returns {Promise<Array>} Array of parsed token events
 */
export async function getRecentTransfers(address, limit = 200) {
  try {
    const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
    const mintSymbol = StellarSdk.nativeToScVal('mint', { type: 'symbol' });
    const burnSymbol = StellarSdk.nativeToScVal('burn', { type: 'symbol' });
    const clawbackSymbol = StellarSdk.nativeToScVal('clawback', { type: 'symbol' });
    const targetScVal = StellarSdk.nativeToScVal(StellarSdk.Address.fromString(address), {
      type: 'address',
    });

    const startLedger = await getLatestLedger();

    // Single filter with 5 topic patterns for all token activity (OR logic):
    // - transfer: [symbol, from, to, asset?] - match from OR to
    // - mint: [symbol, admin, to, asset?] - match to (recipient)
    // - burn: [symbol, from, asset?] - match from
    // - clawback: [symbol, admin, from, asset?] - match from
    const result = await rpcCall('getEvents', {
      startLedger: startLedger,
      filters: [
        {
          type: 'contract',
          topics: [
            [transferSymbol.toXDR('base64'), targetScVal.toXDR('base64'), '*', '**'],  // transfers FROM
            [transferSymbol.toXDR('base64'), '*', targetScVal.toXDR('base64'), '**'],  // transfers TO
            [mintSymbol.toXDR('base64'), '*', targetScVal.toXDR('base64'), '**'],      // mint TO
            [burnSymbol.toXDR('base64'), targetScVal.toXDR('base64'), '**'],           // burn FROM
            [clawbackSymbol.toXDR('base64'), '*', targetScVal.toXDR('base64'), '**'],  // clawback FROM
          ],
        },
      ],
      pagination: { limit: limit * 5, order: 'desc' }
    });

    const events = result.events || [];

    // Dedupe by event ID and parse based on event type
    const uniqueById = new Map();
    for (const event of events) {
      if (uniqueById.has(event.id)) continue;

      const parsed = parseTokenEvent(event, address);
      if (parsed) {
        uniqueById.set(event.id, parsed);
      }
    }

    // Sort by ledger descending and limit
    const activity = [...uniqueById.values()];
    activity.sort((a, b) => b.ledger - a.ledger);

    return activity.slice(0, limit);
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
 * Get unified account activity (transfers, mint, burn, clawback + fees)
 * Uses a single RPC query with 2 filters (token events + fee events)
 * @param {string} address - Address to fetch activity for
 * @param {number} limit - Maximum events to return (default 200)
 * @returns {Promise<Array>} Array of parsed activity items, sorted by timestamp desc
 */
export async function getAccountActivity(address, limit = 200) {
  try {
    const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
    const mintSymbol = StellarSdk.nativeToScVal('mint', { type: 'symbol' });
    const burnSymbol = StellarSdk.nativeToScVal('burn', { type: 'symbol' });
    const clawbackSymbol = StellarSdk.nativeToScVal('clawback', { type: 'symbol' });
    const feeSymbol = StellarSdk.nativeToScVal('fee', { type: 'symbol' });
    const targetScVal = StellarSdk.nativeToScVal(StellarSdk.Address.fromString(address), {
      type: 'address',
    });
    const xlmContractId = StellarSdk.Asset.native().contractId(config.networkPassphrase);

    const startLedger = await getLatestLedger();

    // Two parallel queries:
    // - Query 1: 1 filter with 5 topic patterns for token events (OR logic)
    // - Query 2: 1 filter for fee events (with XLM contractId)
    const [tokenResult, feeResult] = await Promise.all([
      // Token events: 1 filter with 5 topic patterns (OR logic)
      rpcCall('getEvents', {
        startLedger: startLedger,
        filters: [
          {
            type: 'contract',
            topics: [
              [transferSymbol.toXDR('base64'), targetScVal.toXDR('base64'), '*', '**'],  // transfers FROM
              [transferSymbol.toXDR('base64'), '*', targetScVal.toXDR('base64'), '**'],  // transfers TO
              [mintSymbol.toXDR('base64'), '*', targetScVal.toXDR('base64'), '**'],      // mint TO
              [burnSymbol.toXDR('base64'), targetScVal.toXDR('base64'), '**'],           // burn FROM
              [clawbackSymbol.toXDR('base64'), '*', targetScVal.toXDR('base64'), '**'],  // clawback FROM
            ],
          },
        ],
        pagination: { limit: limit * 5, order: 'desc' }
      }),
      // Fee events (with XLM contractId)
      rpcCall('getEvents', {
        startLedger: startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [xlmContractId],
            topics: [[feeSymbol.toXDR('base64'), targetScVal.toXDR('base64')]],
          },
        ],
        pagination: { limit: limit, order: 'desc' }
      }),
    ]);

    const allEvents = [...(tokenResult.events || []), ...(feeResult.events || [])];

    // Parse each event based on first topic, dedupe by event ID
    const uniqueById = new Map();
    for (const event of allEvents) {
      if (uniqueById.has(event.id)) continue;

      // Detect event type from first topic
      const firstTopic = event.topic?.[0];
      if (!firstTopic) continue;

      try {
        const symbol = StellarSdk.scValToNative(StellarSdk.xdr.ScVal.fromXDR(firstTopic, 'base64'));
        if (symbol === 'fee') {
          uniqueById.set(event.id, parseFeeEvent(event, address));
        } else {
          // Use parseTokenEvent for transfer/mint/burn/clawback
          const parsed = parseTokenEvent(event, address);
          if (parsed) {
            uniqueById.set(event.id, parsed);
          }
        }
      } catch {
        // Skip events we can't parse
      }
    }

    // Sort by ledger descending and limit
    const activity = [...uniqueById.values()];
    activity.sort((a, b) => b.ledger - a.ledger);

    return activity.slice(0, limit);
  } catch (error) {
    console.error('Error fetching account activity:', error);
    throw error;
  }
}

/**
 * Get recent token activity across all contracts (network-wide)
 * Fetches transfer, mint, burn, and clawback events (CAP-67)
 * Falls back to transfers-only if combined query hits RPC limits
 * @param {number} limit - Maximum events to return (default 50)
 * @returns {Promise<Array>} Array of parsed token events
 */
export async function getRecentTokenActivity(limit = 50) {
  const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
  const mintSymbol = StellarSdk.nativeToScVal('mint', { type: 'symbol' });
  const burnSymbol = StellarSdk.nativeToScVal('burn', { type: 'symbol' });
  const clawbackSymbol = StellarSdk.nativeToScVal('clawback', { type: 'symbol' });
  const startLedger = await getLatestLedger();

  // Helper to parse events into activity array
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

  // Single filter with 4 topic patterns for all event types (OR logic)
  // May hit RPC limits on busy networks, falls back to transfers only
  try {
    const result = await rpcCall('getEvents', {
      startLedger: startLedger,
      filters: [
        {
          type: 'contract',
          topics: [
            [transferSymbol.toXDR('base64'), '*', '*', '**'],
            [mintSymbol.toXDR('base64'), '*', '*', '**'],
            [burnSymbol.toXDR('base64'), '*', '**'],
            [clawbackSymbol.toXDR('base64'), '*', '*', '**'],
          ],
        },
      ],
      pagination: { limit: limit * 4, order: 'desc' }
    });
    return parseEvents(result.events || []);
  } catch (error) {
    // If we hit processing limits (-32001), fall back to transfers only
    if (error.code === -32001) {
      console.warn('Combined query hit RPC limits, falling back to transfers only');
      try {
        const result = await rpcCall('getEvents', {
          startLedger: startLedger,
          filters: [
            { type: 'contract', topics: [[transferSymbol.toXDR('base64'), '*', '*', '**']] },
          ],
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
 * Fetches transfer, mint, burn, and clawback events (CAP-67) for a specific contract
 * @param {string} tokenContractId - Token contract ID to fetch activity for
 * @param {number} limit - Maximum events to return (default 1000)
 * @returns {Promise<Array>} Array of parsed token events
 */
export async function getTokenTransfers(tokenContractId, limit = 1000) {
  try {
    const transferSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
    const mintSymbol = StellarSdk.nativeToScVal('mint', { type: 'symbol' });
    const burnSymbol = StellarSdk.nativeToScVal('burn', { type: 'symbol' });
    const clawbackSymbol = StellarSdk.nativeToScVal('clawback', { type: 'symbol' });
    const startLedger = await getLatestLedger();

    // Single filter with contractIds and 4 topic patterns (OR logic)
    const result = await rpcCall('getEvents', {
      startLedger: startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [tokenContractId],
          topics: [
            [transferSymbol.toXDR('base64'), '*', '*', '**'],    // transfers
            [mintSymbol.toXDR('base64'), '*', '*', '**'],        // mints
            [burnSymbol.toXDR('base64'), '*', '**'],             // burns
            [clawbackSymbol.toXDR('base64'), '*', '*', '**'],    // clawbacks
          ],
        },
      ],
      pagination: {
        limit: limit * 4,
        order: 'desc'
      }
    });

    const events = result.events || [];

    // Parse and dedupe by event ID
    const uniqueById = new Map();
    for (const event of events) {
      if (uniqueById.has(event.id)) continue;
      const parsed = parseTokenEvent(event);
      if (parsed) {
        uniqueById.set(event.id, parsed);
      }
    }

    // Sort by ledger descending and limit
    const activity = [...uniqueById.values()];
    activity.sort((a, b) => b.ledger - a.ledger);

    return activity.slice(0, limit);
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

  // SAC transfers have a 4th topic with the asset in "ticker:issuer" format
  let sacSymbol = null;
  let sacName = null;
  if (topics.length >= 4 && topics[3]) {
    try {
      const assetStr = StellarSdk.scValToNative(topics[3]);
      if (typeof assetStr === 'string') {
        if (assetStr.includes(':')) {
          sacSymbol = assetStr.split(':')[0];
          sacName = assetStr;
        } else if (assetStr === 'native') {
          sacSymbol = 'XLM';
          sacName = 'native';
        }
      }
    } catch {
      // Not a string topic, ignore
    }
  }

  return {
    txHash: event.txHash,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
    contractId: event.contractId,
    from,
    to,
    amount,
    sacSymbol,
    sacName,
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
export function getCachedMetadata(contractId) {
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
 * Cache token metadata from SAC (Stellar Asset Contract) events.
 * SAC tokens have the symbol in the 4th topic and always use 7 decimals.
 * Only caches if the contract is not already cached.
 * @param {string} contractId - Token contract ID
 * @param {string} sacSymbol - Symbol from SAC event (e.g., "XLM" or "USDC")
 * @param {string} sacFullName - Full SAC identifier (e.g., "USDC:GA5ZSE..." or "native")
 */
export function cacheSacMetadata(contractId, sacSymbol, sacFullName) {
  if (!contractId || !sacSymbol) return;
  // Only cache if not already cached (don't overwrite richer metadata from contract queries)
  if (getCachedMetadata(contractId)) return;
  setCachedMetadata(contractId, {
    symbol: sacSymbol,
    name: sacFullName || sacSymbol,
    decimals: 7,
  });
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

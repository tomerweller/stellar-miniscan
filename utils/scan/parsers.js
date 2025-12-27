/**
 * Pure event parsing functions for Lumenitos Scan
 *
 * These functions parse Stellar/Soroban event data into structured formats.
 * They are pure functions with no side effects, making them easy to test.
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import { scValToAddress, scValToAmount } from '../stellar/helpers.js';

/**
 * Check if an ScVal is an address type
 * @param {object} scVal - The ScVal to check
 * @returns {boolean} True if the ScVal is an address
 */
export function isAddressScVal(scVal) {
  if (!scVal) return false;
  try {
    return scVal.switch().name === 'scvAddress';
  } catch {
    return false;
  }
}

/**
 * Parse topic XDR strings into ScVal objects
 * @param {string[]} topicXdrs - Array of base64-encoded XDR topic strings
 * @returns {Array<object|null>} Array of parsed ScVal objects (or null for parse failures)
 */
export function parseTopics(topicXdrs) {
  return (topicXdrs || []).map(topicXdr => {
    try {
      return StellarSdk.xdr.ScVal.fromXDR(topicXdr, 'base64');
    } catch {
      return null;
    }
  });
}

/**
 * Extract SAC (Stellar Asset Contract) metadata from a topic
 * SAC events include asset info in format "SYMBOL:ISSUER" or "native"
 * @param {object} topic - The ScVal topic
 * @returns {{symbol: string, name: string}|null} SAC metadata or null
 */
export function extractSacMetadata(topic) {
  if (!topic) return null;
  try {
    const assetStr = StellarSdk.scValToNative(topic);
    if (typeof assetStr === 'string') {
      if (assetStr.includes(':')) {
        return {
          symbol: assetStr.split(':')[0],
          name: assetStr,
        };
      } else if (assetStr === 'native') {
        return {
          symbol: 'XLM',
          name: 'native',
        };
      }
    }
  } catch {
    // Not a string topic
  }
  return null;
}

/**
 * Parse event value XDR to extract amount
 * @param {string} valueXdr - Base64-encoded XDR value string
 * @returns {bigint} The amount (0n if parse fails)
 */
export function parseEventValue(valueXdr) {
  if (!valueXdr) return 0n;
  try {
    const valueScVal = StellarSdk.xdr.ScVal.fromXDR(valueXdr, 'base64');
    return scValToAmount(valueScVal);
  } catch {
    return 0n;
  }
}

/**
 * Get the event type symbol from parsed topics
 * @param {Array<object|null>} topics - Parsed ScVal topics
 * @returns {string|null} Event type string or null
 */
export function getEventType(topics) {
  if (!topics[0]) return null;
  try {
    return StellarSdk.scValToNative(topics[0]);
  } catch {
    return null;
  }
}

/**
 * Parse a transfer event into structured format
 * @param {object} event - The event from getEvents
 * @param {string} targetAddress - Address we're tracking
 * @returns {object} Parsed transfer info
 */
export function parseTransferEvent(event, targetAddress) {
  const topics = parseTopics(event.topic);

  let from = 'unknown';
  let to = 'unknown';

  if (topics.length >= 2 && topics[1]) {
    from = scValToAddress(topics[1]);
  }
  if (topics.length >= 3 && topics[2]) {
    to = scValToAddress(topics[2]);
  }

  const amount = parseEventValue(event.value);

  // SAC transfers have a 4th topic with the asset
  const sacMetadata = topics.length >= 4 ? extractSacMetadata(topics[3]) : null;

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
    sacSymbol: sacMetadata?.symbol || null,
    sacName: sacMetadata?.name || null,
  };
}

/**
 * Parse a CAP-67 token event (transfer, mint, burn, clawback) into structured format
 * Only returns events that conform to the CAP-67 specification with proper address topics
 * @param {object} event - The event from getEvents
 * @param {string} targetAddress - Address we're tracking (optional)
 * @returns {object|null} Parsed event info or null if unrecognized or non-conforming
 */
export function parseTokenEvent(event, targetAddress = null) {
  const topics = parseTopics(event.topic);

  if (!topics[0]) return null;

  const eventType = getEventType(topics);
  if (!eventType) return null;

  const amount = parseEventValue(event.value);

  // Extract SAC asset info from last topic if present
  const lastTopic = topics[topics.length - 1];
  const sacMetadata = extractSacMetadata(lastTopic);

  const baseEvent = {
    txHash: event.txHash,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
    contractId: event.contractId,
    amount,
    sacSymbol: sacMetadata?.symbol || null,
    sacName: sacMetadata?.name || null,
  };

  // Parse based on event type - validate CAP-67 format with proper address topics
  if (eventType === 'transfer') {
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
    if (!isAddressScVal(topics[1]) || !isAddressScVal(topics[2])) {
      return null;
    }
    const admin = scValToAddress(topics[1]);
    const to = scValToAddress(topics[2]);
    return {
      ...baseEvent,
      type: 'mint',
      from: admin,
      to,
      direction: 'received',
      counterparty: admin,
    };
  }

  if (eventType === 'burn') {
    if (!isAddressScVal(topics[1])) {
      return null;
    }
    const from = scValToAddress(topics[1]);
    return {
      ...baseEvent,
      type: 'burn',
      from,
      to: null,
      direction: 'sent',
      counterparty: null,
    };
  }

  if (eventType === 'clawback') {
    if (!isAddressScVal(topics[1]) || !isAddressScVal(topics[2])) {
      return null;
    }
    const admin = scValToAddress(topics[1]);
    const from = scValToAddress(topics[2]);
    return {
      ...baseEvent,
      type: 'clawback',
      from,
      to: admin,
      direction: 'sent',
      counterparty: admin,
    };
  }

  return null;
}

/**
 * Parse a fee event into structured format (CAP-67)
 * @param {object} event - The event from getEvents
 * @param {string} address - The address paying/receiving fees
 * @returns {object} Parsed fee event info
 */
export function parseFeeEvent(event, address) {
  const amount = parseEventValue(event.value);

  // Negative amount = refund (per CAP-67 spec)
  const isRefund = amount < 0n;

  return {
    txHash: event.txHash,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
    contractId: event.contractId,
    from: address,
    amount: isRefund ? -amount : amount,
    isRefund,
    type: 'fee',
  };
}

/**
 * Parse a contract event into structured format (for invocation display)
 * @param {object} event - The event from getEvents
 * @returns {object} Parsed event info
 */
export function parseContractEvent(event) {
  const topics = parseTopics(event.topic);

  // Convert topics to native values for display
  const parsedTopics = topics.map(topic => {
    if (!topic) return null;
    try {
      return StellarSdk.scValToNative(topic);
    } catch {
      if (topic.switch().name === 'scvAddress') {
        return scValToAddress(topic);
      }
      return topic.switch().name;
    }
  });

  const eventType = parsedTopics[0] || 'unknown';

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
    topics: parsedTopics.slice(1),
    value,
    inSuccessfulContractCall: event.inSuccessfulContractCall,
  };
}

/**
 * Parse a transfer event without target address context (generic)
 * @param {object} event - The event from getEvents
 * @returns {object} Parsed transfer info
 */
export function parseTransferEventGeneric(event) {
  const topics = parseTopics(event.topic);

  let from = 'unknown';
  let to = 'unknown';

  if (topics.length >= 2 && topics[1]) {
    from = scValToAddress(topics[1]);
  }
  if (topics.length >= 3 && topics[2]) {
    to = scValToAddress(topics[2]);
  }

  const amount = parseEventValue(event.value);
  const sacMetadata = topics.length >= 4 ? extractSacMetadata(topics[3]) : null;

  return {
    txHash: event.txHash,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
    contractId: event.contractId,
    from,
    to,
    amount,
    sacSymbol: sacMetadata?.symbol || null,
    sacName: sacMetadata?.name || null,
  };
}

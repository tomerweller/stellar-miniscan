/**
 * CAP-67 Database Client for Stellar MiniScan
 *
 * Uses cap67db (https://github.com/tomerweller/cap67db) as an alternative
 * to Soroban RPC getEvents for fetching token events.
 *
 * Benefits:
 * - Pre-parsed events (no XDR parsing needed)
 * - Simpler query interface
 * - Dedicated indexer (more reliable than RPC limits)
 */

const CAP67DB_URL = 'https://159-65-224-222.sslip.io';

/**
 * Fetch events from cap67db
 * @param {object} params - Query parameters
 * @param {string} params.type - Comma-separated event types (transfer,mint,burn,clawback,fee)
 * @param {string} params.account - Filter by account (sender or recipient)
 * @param {string} params.contractId - Filter by contract ID
 * @param {number} params.limit - Max results (1-1000)
 * @param {string} params.order - Sort order (asc or desc)
 * @param {string} params.cursor - Pagination cursor
 * @returns {Promise<{events: Array, cursor: string}>}
 */
export async function fetchEvents(params = {}) {
  const url = new URL(`${CAP67DB_URL}/events`);

  if (params.type) url.searchParams.set('type', params.type);
  if (params.account) url.searchParams.set('account', params.account);
  if (params.contractId) url.searchParams.set('contract_id', params.contractId);
  if (params.limit) url.searchParams.set('limit', String(params.limit));
  if (params.order) url.searchParams.set('order', params.order);
  if (params.cursor) url.searchParams.set('cursor', params.cursor);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(1000),
  });

  if (!response.ok) {
    throw new Error(`cap67db request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Check if cap67db is healthy
 * @returns {Promise<boolean>}
 */
export async function isHealthy() {
  try {
    const response = await fetch(`${CAP67DB_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Parse asset_name field into symbol and full name
 * Format is either "native" or "SYMBOL:ISSUER"
 * @param {string} assetName - The asset_name from cap67db
 * @returns {{symbol: string, name: string}}
 */
function parseAssetName(assetName) {
  if (!assetName) return { symbol: null, name: null };

  if (assetName === 'native') {
    return { symbol: 'XLM', name: 'native' };
  }

  if (assetName.includes(':')) {
    return {
      symbol: assetName.split(':')[0],
      name: assetName,
    };
  }

  return { symbol: assetName, name: assetName };
}

/**
 * Convert a cap67db event to our internal format
 * @param {object} event - Event from cap67db
 * @param {string} targetAddress - Address we're tracking (optional)
 * @returns {object} Event in our internal format
 */
export function adaptEvent(event, targetAddress = null) {
  const { symbol, name } = parseAssetName(event.asset_name);

  const from = event.account || 'unknown';
  const to = event.to_account || null;

  // Determine direction based on target address
  let direction = 'received';
  if (targetAddress) {
    direction = from === targetAddress ? 'sent' : 'received';
  }

  const baseEvent = {
    id: event.id,
    txHash: event.tx_hash,
    ledger: event.ledger_sequence,
    timestamp: event.closed_at,
    contractId: event.contract_id,
    amount: BigInt(event.amount),
    sacSymbol: symbol,
    sacName: name,
    inSuccessfulContractCall: event.successful && event.in_successful_txn,
  };

  switch (event.type) {
    case 'transfer':
      return {
        ...baseEvent,
        type: 'transfer',
        from,
        to,
        direction,
        counterparty: direction === 'sent' ? to : from,
      };

    case 'mint':
      return {
        ...baseEvent,
        type: 'mint',
        from, // admin/minter
        to: event.to_account || event.account,
        direction: 'received',
        counterparty: from,
      };

    case 'burn':
      return {
        ...baseEvent,
        type: 'burn',
        from,
        to: null,
        direction: 'sent',
        counterparty: null,
      };

    case 'clawback':
      return {
        ...baseEvent,
        type: 'clawback',
        from: event.to_account || from, // clawed back from
        to: from, // admin who clawed back
        direction: 'sent',
        counterparty: from,
      };

    case 'fee':
      const amount = BigInt(event.amount);
      const isRefund = amount < 0n;
      return {
        ...baseEvent,
        type: 'fee',
        from,
        amount: isRefund ? -amount : amount,
        isRefund,
      };

    default:
      return {
        ...baseEvent,
        type: event.type,
        from,
        to,
      };
  }
}

// Event types to exclude from non-fee activity views
const NON_TOKEN_TYPES = ['fee', 'set_authorized'];

/**
 * Fetch and adapt token events for an address (excludes fees)
 * @param {string} address - Address to fetch activity for
 * @param {number} limit - Maximum events to return
 * @returns {Promise<Array>} Array of adapted events
 */
export async function getAddressActivity(address, limit = 200) {
  const result = await fetchEvents({
    account: address,
    limit,
    order: 'desc',
  });

  // Filter out fee and set_authorized events client-side
  return (result.events || [])
    .filter(e => !NON_TOKEN_TYPES.includes(e.type))
    .map(e => adaptEvent(e, address));
}

/**
 * Fetch and adapt all events for an address (includes fees)
 * @param {string} address - Address to fetch activity for
 * @param {number} limit - Maximum events to return
 * @returns {Promise<Array>} Array of adapted events
 */
export async function getAddressActivityWithFees(address, limit = 200) {
  const result = await fetchEvents({
    account: address,
    limit,
    order: 'desc',
  });

  // Filter out set_authorized events, keep fees
  return (result.events || [])
    .filter(e => e.type !== 'set_authorized')
    .map(e => adaptEvent(e, address));
}

/**
 * Fetch and adapt network-wide token activity (excludes fees)
 * @param {number} limit - Maximum events to return
 * @returns {Promise<Array>} Array of adapted events
 */
export async function getNetworkActivity(limit = 200) {
  const result = await fetchEvents({
    limit,
    order: 'desc',
  });

  // Filter out fee and set_authorized events client-side
  return (result.events || [])
    .filter(e => !NON_TOKEN_TYPES.includes(e.type))
    .map(e => adaptEvent(e));
}

/**
 * Fetch and adapt token activity for a specific contract (excludes fees)
 * @param {string} contractId - Token contract ID
 * @param {number} limit - Maximum events to return
 * @returns {Promise<Array>} Array of adapted events
 */
export async function getContractActivity(contractId, limit = 200) {
  const result = await fetchEvents({
    contractId,
    limit,
    order: 'desc',
  });

  // Filter out fee and set_authorized events client-side
  return (result.events || [])
    .filter(e => !NON_TOKEN_TYPES.includes(e.type))
    .map(e => adaptEvent(e));
}

/**
 * Fetch and adapt fee events for an address
 * @param {string} address - Address to fetch fee events for
 * @param {number} limit - Maximum events to return
 * @returns {Promise<Array>} Array of adapted fee events
 */
export async function getAddressFeeEvents(address, limit = 200) {
  const result = await fetchEvents({
    account: address,
    limit,
    order: 'desc',
  });

  // Filter to only fee events client-side
  return (result.events || [])
    .filter(e => e.type === 'fee')
    .map(e => adaptEvent(e, address));
}

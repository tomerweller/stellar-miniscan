/**
 * Shared display helpers for Stellar MiniScan
 *
 * These utilities are used across multiple scan pages for consistent
 * formatting and display of addresses, timestamps, and amounts.
 */

import config, { getNetworkConfig } from '@/utils/config';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Shorten an address for display (6....6 format)
 * @param {string} addr - The full address
 * @returns {string} Shortened address or original if too short
 */
export const shortenAddress = (addr) => {
  if (!addr || addr.length < 12) return addr;
  return `${addr.substring(0, 6)}....${addr.substring(addr.length - 6)}`;
};

/**
 * Shorten an address more aggressively (4..4 format)
 * Used in transfer lists where space is limited
 * @param {string} addr - The full address
 * @returns {string} Shortened address or original if too short
 */
export const shortenAddressSmall = (addr) => {
  if (!addr || addr.length < 12) return addr;
  return `${addr.substring(0, 4)}..${addr.substring(addr.length - 4)}`;
};

/**
 * Format a timestamp for display using locale string
 * @param {string|number} timestamp - ISO string or Unix timestamp
 * @returns {string} Formatted date/time or empty string
 */
export const formatTimestamp = (timestamp) => {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString();
};

/**
 * Format a Unix timestamp (in seconds) for display
 * Used for transaction timestamps from RPC
 * @param {string|number} timestamp - Unix timestamp in seconds
 * @returns {string} Formatted date/time or 'N/A'
 */
export const formatUnixTimestamp = (timestamp) => {
  if (!timestamp) return 'N/A';
  const seconds = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
  return new Date(seconds * 1000).toLocaleString();
};

/**
 * Format a timestamp as relative time (e.g., "5 sec ago", "2 min ago")
 * Falls back to time-only for timestamps older than 24 hours
 * @param {string|number} timestamp - ISO string or Unix timestamp
 * @returns {string} Relative time string
 */
export const formatRelativeTime = (timestamp) => {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) {
    return `${diffSec} sec ago`;
  }
  if (diffMin < 60) {
    return `${diffMin} min ago`;
  }
  if (diffHour < 24) {
    return `${diffHour} hr ago`;
  }

  // For older timestamps, show time only
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * Format time only (no date) from timestamp
 * @param {string|number} timestamp - ISO string or Unix timestamp
 * @returns {string} Time string (e.g., "3:38 PM")
 */
export const formatTimeOnly = (timestamp) => {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

/**
 * Get the internal route path for an address based on its type
 * G... -> /account/, C... -> /contract/, L... -> /lp/
 * @param {string} addr - The address
 * @returns {string} The route path
 */
export const getAddressPath = (addr) => {
  if (!addr) return '/';
  if (addr.startsWith('C')) {
    return `/contract/${addr}`;
  }
  if (addr.startsWith('L')) {
    return `/lp/${addr}`;
  }
  return `/account/${addr}`;
};

/**
 * Get the stellar.expert URL for an address
 * @param {string} addr - The address
 * @param {string} [network] - Optional network override ('testnet' or 'mainnet')
 * @returns {string} The stellar.expert URL
 */
export const getStellarExpertUrl = (addr, network) => {
  // Use passed network or fall back to config
  const explorerUrl = network
    ? getNetworkConfig(network).explorerUrl
    : config.stellar.explorerUrl;

  if (!addr) return explorerUrl;

  if (addr.startsWith('L')) {
    // Liquidity pool - stellar.expert uses hex pool ID, not L... address
    try {
      const poolId = StrKey.decodeLiquidityPool(addr);
      return `${explorerUrl}/liquidity-pool/${poolId.toString('hex')}`;
    } catch {
      return `${explorerUrl}/liquidity-pool/${addr}`;
    }
  }
  if (addr.startsWith('C')) {
    return `${explorerUrl}/contract/${addr}`;
  }
  return `${explorerUrl}/account/${addr}`;
};

/**
 * Check if an address is a liquidity pool (L...)
 * @param {string} addr - The address
 * @returns {boolean}
 */
export const isLiquidityPool = (addr) => {
  return addr?.startsWith('L') ?? false;
};

/**
 * Check if an address is a contract (C...)
 * @param {string} addr - The address
 * @returns {boolean}
 */
export const isContract = (addr) => {
  return addr?.startsWith('C') ?? false;
};

/**
 * Check if an address is an account (G...)
 * @param {string} addr - The address
 * @returns {boolean}
 */
export const isAccount = (addr) => {
  return addr?.startsWith('G') ?? false;
};

/**
 * Format a topic/event value for display
 * Handles addresses, BigInt, and objects
 * @param {any} value - The value to format
 * @returns {string} Formatted string
 */
export const formatTopicValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    // If it looks like an address, shorten it
    if (value.startsWith('G') || value.startsWith('C') || value.startsWith('L')) {
      return shortenAddressSmall(value);
    }
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'object') {
    // For objects with 'amount' key, just show the amount
    if (value.amount !== undefined) {
      return value.amount.toString();
    }
    // Use replacer to handle BigInt inside objects
    return JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
  }
  return String(value);
};

/**
 * Copy text to clipboard and manage copied state
 * @param {string} text - Text to copy
 * @param {function} setCopied - State setter for copied flag
 * @param {number} timeout - Reset timeout in ms (default 2000)
 */
export const copyToClipboard = (text, setCopied, timeout = 2000) => {
  navigator.clipboard.writeText(text);
  setCopied(true);
  setTimeout(() => setCopied(false), timeout);
};

/**
 * Get transaction status display class
 * @param {string} status - Transaction status (SUCCESS, FAILED, NOT_FOUND)
 * @returns {string} CSS class name
 */
export const getStatusClass = (status) => {
  switch (status) {
    case 'SUCCESS': return 'success';
    case 'FAILED': return 'error';
    case 'NOT_FOUND': return 'warning';
    default: return '';
  }
};

/**
 * Get network label class based on config
 * @returns {string} CSS class for network label
 */
export const getNetworkClass = () => {
  return config.isTestnet ? 'testnet' : 'mainnet';
};

/**
 * Get network label text based on config
 * @returns {string} Network label text
 */
export const getNetworkLabel = () => {
  return config.isTestnet ? config.stellar.network : 'MAINNET';
};

/**
 * Format error message for user-friendly display
 * Converts technical RPC errors to readable messages
 * @param {string} error - The error message
 * @returns {string} User-friendly error message
 */
export const formatErrorMessage = (error) => {
  if (!error) return 'Unknown error';

  // RPC error -32001: request exceeded processing limit threshold
  if (error.includes('-32001') || error.includes('processing limit')) {
    return 'Too much data to process. Try a different query or check back later.';
  }

  // Network/connection errors
  if (error.includes('fetch') || error.includes('network') || error.includes('ECONNREFUSED')) {
    return 'Network error. Please check your connection and try again.';
  }

  // Not found errors
  if (error.includes('not found') || error.includes('404')) {
    return 'Not found';
  }

  // Return original error if no special handling
  return error;
};

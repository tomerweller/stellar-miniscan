/**
 * Pure validation functions for Lumenitos Scan
 *
 * These functions validate Stellar addresses and other inputs.
 * They are pure functions with no side effects.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

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
      const poolId = StellarSdk.StrKey.decodeLiquidityPool(address);
      return poolId && poolId.length === 32;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if an address is a classic account (G...)
 * @param {string} address - The address to check
 * @returns {boolean}
 */
export function isAccountAddress(address) {
  return typeof address === 'string' && address.startsWith('G');
}

/**
 * Check if an address is a contract (C...)
 * @param {string} address - The address to check
 * @returns {boolean}
 */
export function isContractAddress(address) {
  return typeof address === 'string' && address.startsWith('C');
}

/**
 * Check if an address is a liquidity pool (L...)
 * @param {string} address - The address to check
 * @returns {boolean}
 */
export function isLiquidityPoolAddress(address) {
  return typeof address === 'string' && address.startsWith('L');
}

/**
 * Check if a string is a valid transaction hash (64 hex characters)
 * @param {string} hash - The hash to validate
 * @returns {boolean}
 */
export function isValidTxHash(hash) {
  if (!hash || typeof hash !== 'string') {
    return false;
  }
  return /^[a-fA-F0-9]{64}$/.test(hash);
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

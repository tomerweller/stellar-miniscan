/**
 * Stellar helper utilities for MiniScan
 */

import * as StellarSdk from '@stellar/stellar-sdk';

/**
 * Convert raw token amount to display amount based on decimals
 * @param {bigint | number | string} rawAmount - Raw amount from contract
 * @param {number} decimals - Token decimals (default 7)
 * @returns {number} Display amount
 */
export function rawToDisplay(rawAmount, decimals = 7) {
  return Number(rawAmount) / Math.pow(10, decimals);
}

/**
 * Format token balance for display
 * @param {number} balance - Balance as a number
 * @param {number} decimals - Token decimals for precision (default 7)
 * @returns {string} Formatted balance
 */
export function formatTokenBalance(balance, decimals = 7) {
  if (balance === 0) {
    return '0';
  }
  // Use token's decimals for precision, but trim trailing zeros
  return balance.toFixed(decimals).replace(/\.?0+$/, '');
}

/**
 * Extract address string from ScVal
 * @param {StellarSdk.xdr.ScVal} scVal - The ScVal
 * @returns {string} The address string
 */
export function scValToAddress(scVal) {
  try {
    const native = StellarSdk.scValToNative(scVal);
    if (typeof native === 'string') {
      return native;
    }
    if (native && typeof native.toString === 'function') {
      return native.toString();
    }
    return String(native);
  } catch {
    if (scVal.switch().name === 'scvAddress') {
      const addr = scVal.address();
      if (addr.switch().name === 'scAddressTypeAccount') {
        return StellarSdk.Address.account(addr.accountId().ed25519()).toString();
      } else if (addr.switch().name === 'scAddressTypeContract') {
        return StellarSdk.Address.contract(addr.contractId()).toString();
      }
    }
    return 'unknown';
  }
}

/**
 * Extract amount from ScVal (i128 or map with amount field per SEP-0041)
 * When muxed IDs are used, the value is a map: { amount: i128, to_muxed_id: ... }
 * @param {StellarSdk.xdr.ScVal} scVal - The ScVal
 * @returns {bigint} The amount
 */
export function scValToAmount(scVal) {
  try {
    const native = StellarSdk.scValToNative(scVal);
    // If it's a map (muxed transfer per SEP-0041), extract the amount field
    if (native && typeof native === 'object' && 'amount' in native) {
      return BigInt(native.amount);
    }
    return BigInt(native);
  } catch {
    if (scVal.switch().name === 'scvI128') {
      const parts = scVal.i128();
      const hi = BigInt(parts.hi().toString());
      const lo = BigInt(parts.lo().toString());
      return (hi << 64n) | lo;
    }
    // Handle map case manually if scValToNative failed
    if (scVal.switch().name === 'scvMap') {
      const entries = scVal.map();
      for (const entry of entries) {
        const key = entry.key();
        if (key.switch().name === 'scvSymbol' && key.sym().toString() === 'amount') {
          return scValToAmount(entry.val());
        }
      }
    }
    return 0n;
  }
}

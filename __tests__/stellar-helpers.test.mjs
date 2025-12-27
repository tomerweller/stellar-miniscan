/**
 * Tests for utils/stellar/helpers.js
 *
 * These are helper functions for Stellar SDK value conversions.
 */

import { rawToDisplay, formatTokenBalance } from '../utils/stellar/helpers.js';

describe('rawToDisplay', () => {
  it('should convert raw amount with default 7 decimals', () => {
    expect(rawToDisplay(10000000, 7)).toBe(1);
    expect(rawToDisplay(50000000, 7)).toBe(5);
  });

  it('should handle different decimal places', () => {
    expect(rawToDisplay(1000000, 6)).toBe(1);
    expect(rawToDisplay(100000000, 8)).toBe(1);
  });

  it('should handle BigInt', () => {
    expect(rawToDisplay(BigInt(10000000), 7)).toBe(1);
  });

  it('should handle string amounts', () => {
    expect(rawToDisplay('10000000', 7)).toBe(1);
  });

  it('should handle zero', () => {
    expect(rawToDisplay(0, 7)).toBe(0);
  });

  it('should handle fractional amounts', () => {
    expect(rawToDisplay(1234567, 7)).toBeCloseTo(0.1234567);
  });
});

describe('formatTokenBalance', () => {
  it('should format whole numbers without trailing zeros', () => {
    expect(formatTokenBalance(100)).toBe('100');
    expect(formatTokenBalance(1)).toBe('1');
  });

  it('should format decimals and trim trailing zeros', () => {
    expect(formatTokenBalance(1.5)).toBe('1.5');
    expect(formatTokenBalance(1.50)).toBe('1.5');
    expect(formatTokenBalance(1.500)).toBe('1.5');
  });

  it('should return 0 for zero balance', () => {
    expect(formatTokenBalance(0)).toBe('0');
  });

  it('should preserve meaningful decimal places', () => {
    expect(formatTokenBalance(0.1234567, 7)).toBe('0.1234567');
    expect(formatTokenBalance(0.123, 7)).toBe('0.123');
  });

  it('should handle very small amounts', () => {
    expect(formatTokenBalance(0.0000001, 7)).toBe('0.0000001');
  });
});

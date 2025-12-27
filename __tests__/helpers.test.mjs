/**
 * Tests for utils/scan/helpers.js
 *
 * These are pure display helper functions with no side effects.
 */

import {
  shortenAddress,
  shortenAddressSmall,
  formatTimestamp,
  formatUnixTimestamp,
  getAddressPath,
  isLiquidityPool,
  isContract,
  isAccount,
  formatTopicValue,
  getStatusClass,
} from '../utils/scan/helpers.js';

describe('shortenAddress', () => {
  it('should shorten a valid G address', () => {
    const addr = 'GBTO1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890JJZV';
    expect(shortenAddress(addr)).toBe('GBTO12....90JJZV');
  });

  it('should shorten a valid C address', () => {
    const addr = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
    expect(shortenAddress(addr)).toBe('CCW67T....SJMI75');
  });

  it('should return original if too short', () => {
    expect(shortenAddress('ABC')).toBe('ABC');
    expect(shortenAddress('ABCDEFGHIJ')).toBe('ABCDEFGHIJ');
  });

  it('should handle null/undefined', () => {
    expect(shortenAddress(null)).toBe(null);
    expect(shortenAddress(undefined)).toBe(undefined);
  });
});

describe('shortenAddressSmall', () => {
  it('should shorten more aggressively (4..4)', () => {
    const addr = 'GBTO1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890JJZV';
    expect(shortenAddressSmall(addr)).toBe('GBTO..JJZV');
  });

  it('should return original if too short', () => {
    expect(shortenAddressSmall('ABCDEFGH')).toBe('ABCDEFGH');
  });
});

describe('formatTimestamp', () => {
  it('should format ISO timestamp', () => {
    const timestamp = '2024-01-15T12:00:00Z';
    const formatted = formatTimestamp(timestamp);
    expect(formatted).toBeTruthy();
    expect(typeof formatted).toBe('string');
  });

  it('should return empty string for falsy input', () => {
    expect(formatTimestamp(null)).toBe('');
    expect(formatTimestamp(undefined)).toBe('');
    expect(formatTimestamp('')).toBe('');
  });
});

describe('formatUnixTimestamp', () => {
  it('should format Unix timestamp in seconds', () => {
    const timestamp = 1705320000; // 2024-01-15 12:00:00 UTC
    const formatted = formatUnixTimestamp(timestamp);
    expect(formatted).toBeTruthy();
    expect(formatted).not.toBe('N/A');
  });

  it('should handle string timestamps', () => {
    const formatted = formatUnixTimestamp('1705320000');
    expect(formatted).not.toBe('N/A');
  });

  it('should return N/A for falsy input', () => {
    expect(formatUnixTimestamp(null)).toBe('N/A');
    expect(formatUnixTimestamp(undefined)).toBe('N/A');
  });
});

describe('getAddressPath', () => {
  it('should return /account/ for G addresses', () => {
    expect(getAddressPath('GABC123')).toBe('/account/GABC123');
  });

  it('should return /contract/ for C addresses', () => {
    expect(getAddressPath('CABC123')).toBe('/contract/CABC123');
  });

  it('should return /lp/ for L addresses', () => {
    expect(getAddressPath('LABC123')).toBe('/lp/LABC123');
  });

  it('should return / for null/undefined', () => {
    expect(getAddressPath(null)).toBe('/');
    expect(getAddressPath(undefined)).toBe('/');
  });
});

describe('address type checks', () => {
  describe('isLiquidityPool', () => {
    it('should return true for L addresses', () => {
      expect(isLiquidityPool('LABC123')).toBe(true);
    });

    it('should return false for other addresses', () => {
      expect(isLiquidityPool('GABC123')).toBe(false);
      expect(isLiquidityPool('CABC123')).toBe(false);
    });

    it('should handle null/undefined', () => {
      expect(isLiquidityPool(null)).toBe(false);
      expect(isLiquidityPool(undefined)).toBe(false);
    });
  });

  describe('isContract', () => {
    it('should return true for C addresses', () => {
      expect(isContract('CABC123')).toBe(true);
    });

    it('should return false for other addresses', () => {
      expect(isContract('GABC123')).toBe(false);
      expect(isContract('LABC123')).toBe(false);
    });
  });

  describe('isAccount', () => {
    it('should return true for G addresses', () => {
      expect(isAccount('GABC123')).toBe(true);
    });

    it('should return false for other addresses', () => {
      expect(isAccount('CABC123')).toBe(false);
      expect(isAccount('LABC123')).toBe(false);
    });
  });
});

describe('formatTopicValue', () => {
  it('should shorten addresses', () => {
    const addr = 'GBTO1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890JJZV';
    expect(formatTopicValue(addr)).toBe('GBTO..JJZV');
  });

  it('should convert BigInt to string', () => {
    expect(formatTopicValue(BigInt(12345))).toBe('12345');
  });

  it('should handle regular strings', () => {
    expect(formatTopicValue('hello')).toBe('hello');
  });

  it('should handle null/undefined', () => {
    expect(formatTopicValue(null)).toBe('');
    expect(formatTopicValue(undefined)).toBe('');
  });

  it('should extract amount from objects', () => {
    expect(formatTopicValue({ amount: 100 })).toBe('100');
  });
});

describe('getStatusClass', () => {
  it('should return success for SUCCESS', () => {
    expect(getStatusClass('SUCCESS')).toBe('success');
  });

  it('should return error for FAILED', () => {
    expect(getStatusClass('FAILED')).toBe('error');
  });

  it('should return warning for NOT_FOUND', () => {
    expect(getStatusClass('NOT_FOUND')).toBe('warning');
  });

  it('should return empty string for unknown', () => {
    expect(getStatusClass('UNKNOWN')).toBe('');
  });
});

/**
 * Tests for utils/scan/index.js
 *
 * Tests for address validation and contract ID extraction.
 * These are pure functions that don't require RPC mocking.
 */

import {
  isValidAddress,
  extractContractIds,
} from '../utils/scan/index.js';

// Sample valid addresses for testing
const VALID_G_ADDRESS = 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR';
const VALID_C_ADDRESS = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const VALID_L_ADDRESS = 'LD7CUO3PHUGID3WOTMLZZQNXCYEBQQHD4HQXTEW2DJPP4B7HQSBVFN34';

describe('isValidAddress', () => {
  describe('G addresses (accounts)', () => {
    it('should validate correct G address', () => {
      expect(isValidAddress(VALID_G_ADDRESS)).toBe(true);
    });

    it('should reject invalid G address with bad checksum', () => {
      expect(isValidAddress('GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNS0')).toBe(false);
    });

    it('should reject G address with wrong length', () => {
      expect(isValidAddress('GAIH3ULLFQ4DGSECF2AR555')).toBe(false);
    });
  });

  describe('C addresses (contracts)', () => {
    it('should validate correct C address', () => {
      expect(isValidAddress(VALID_C_ADDRESS)).toBe(true);
    });

    it('should reject invalid C address', () => {
      expect(isValidAddress('CINVALIDADDRESS')).toBe(false);
    });
  });

  describe('L addresses (liquidity pools)', () => {
    it('should validate correct L address', () => {
      expect(isValidAddress(VALID_L_ADDRESS)).toBe(true);
    });

    it('should reject invalid L address', () => {
      expect(isValidAddress('LINVALIDADDRESS')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return false for null', () => {
      expect(isValidAddress(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidAddress(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidAddress('')).toBe(false);
    });

    it('should return false for non-string', () => {
      expect(isValidAddress(123)).toBe(false);
      expect(isValidAddress({})).toBe(false);
    });

    it('should return false for addresses starting with other letters', () => {
      expect(isValidAddress('AABC123')).toBe(false);
      expect(isValidAddress('XABC123')).toBe(false);
    });
  });
});

describe('extractContractIds', () => {
  it('should extract unique contract IDs from transfers', () => {
    const transfers = [
      { contractId: 'CABC123' },
      { contractId: 'CDEF456' },
      { contractId: 'CABC123' }, // duplicate
      { contractId: 'CGHI789' },
    ];

    const result = extractContractIds(transfers);

    expect(result).toHaveLength(3);
    expect(result).toContain('CABC123');
    expect(result).toContain('CDEF456');
    expect(result).toContain('CGHI789');
  });

  it('should return empty array for empty input', () => {
    expect(extractContractIds([])).toEqual([]);
  });

  it('should skip transfers without contractId', () => {
    const transfers = [
      { contractId: 'CABC123' },
      { amount: 100 }, // no contractId
      { contractId: null },
    ];

    const result = extractContractIds(transfers);
    expect(result).toEqual(['CABC123']);
  });
});

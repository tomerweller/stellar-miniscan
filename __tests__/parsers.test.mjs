/**
 * Tests for utils/scan/parsers.js
 *
 * Pure event parsing functions that can be tested without mocking.
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import {
  isAddressScVal,
  parseTopics,
  extractSacMetadata,
  parseEventValue,
  getEventType,
  parseTokenEvent,
  parseFeeEvent,
} from '../utils/scan/parsers.js';

describe('isAddressScVal', () => {
  it('should return true for address ScVal', () => {
    const address = StellarSdk.Address.fromString('GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR');
    const scVal = address.toScVal();
    expect(isAddressScVal(scVal)).toBe(true);
  });

  it('should return false for non-address ScVal', () => {
    const scVal = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
    expect(isAddressScVal(scVal)).toBe(false);
  });

  it('should return false for null/undefined', () => {
    expect(isAddressScVal(null)).toBe(false);
    expect(isAddressScVal(undefined)).toBe(false);
  });
});

describe('parseTopics', () => {
  it('should parse valid base64 XDR topics', () => {
    const symbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
    const xdr = symbol.toXDR('base64');
    const topics = parseTopics([xdr]);

    expect(topics).toHaveLength(1);
    expect(topics[0]).not.toBeNull();
  });

  it('should return null for invalid XDR', () => {
    const topics = parseTopics(['invalid-xdr']);
    expect(topics[0]).toBeNull();
  });

  it('should handle empty array', () => {
    expect(parseTopics([])).toEqual([]);
  });

  it('should handle null/undefined input', () => {
    expect(parseTopics(null)).toEqual([]);
    expect(parseTopics(undefined)).toEqual([]);
  });
});

describe('extractSacMetadata', () => {
  it('should extract metadata from SYMBOL:ISSUER format', () => {
    const topic = StellarSdk.nativeToScVal('USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', { type: 'string' });
    const metadata = extractSacMetadata(topic);

    expect(metadata).not.toBeNull();
    expect(metadata.symbol).toBe('USDC');
    expect(metadata.name).toBe('USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
  });

  it('should extract metadata from native', () => {
    const topic = StellarSdk.nativeToScVal('native', { type: 'string' });
    const metadata = extractSacMetadata(topic);

    expect(metadata).not.toBeNull();
    expect(metadata.symbol).toBe('XLM');
    expect(metadata.name).toBe('native');
  });

  it('should return null for non-SAC topics', () => {
    const topic = StellarSdk.nativeToScVal('random-string', { type: 'string' });
    const metadata = extractSacMetadata(topic);
    expect(metadata).toBeNull();
  });

  it('should return null for null topic', () => {
    expect(extractSacMetadata(null)).toBeNull();
  });
});

describe('parseEventValue', () => {
  it('should parse i128 amount', () => {
    const amount = StellarSdk.nativeToScVal(BigInt(1000000), { type: 'i128' });
    const xdr = amount.toXDR('base64');
    expect(parseEventValue(xdr)).toBe(BigInt(1000000));
  });

  it('should return 0n for invalid XDR', () => {
    expect(parseEventValue('invalid')).toBe(0n);
  });

  it('should return 0n for null/undefined', () => {
    expect(parseEventValue(null)).toBe(0n);
    expect(parseEventValue(undefined)).toBe(0n);
  });
});

describe('getEventType', () => {
  it('should extract event type symbol', () => {
    const symbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
    const topics = [symbol];
    expect(getEventType(topics)).toBe('transfer');
  });

  it('should return null for empty topics', () => {
    expect(getEventType([])).toBeNull();
    expect(getEventType([null])).toBeNull();
  });
});

describe('parseTokenEvent', () => {
  // Helper to create a mock event
  function createMockEvent(type, from, to, amount, sacAsset = null) {
    const typeSymbol = StellarSdk.nativeToScVal(type, { type: 'symbol' });
    const fromAddr = StellarSdk.Address.fromString(from).toScVal();
    const toAddr = to ? StellarSdk.Address.fromString(to).toScVal() : null;
    const amountVal = StellarSdk.nativeToScVal(BigInt(amount), { type: 'i128' });

    const topics = [typeSymbol.toXDR('base64'), fromAddr.toXDR('base64')];
    if (toAddr) {
      topics.push(toAddr.toXDR('base64'));
    }
    if (sacAsset) {
      const assetStr = StellarSdk.nativeToScVal(sacAsset, { type: 'string' });
      topics.push(assetStr.toXDR('base64'));
    }

    return {
      id: 'test-id',
      txHash: 'abc123',
      ledger: 1000,
      ledgerClosedAt: '2024-01-01T00:00:00Z',
      contractId: 'CABC123',
      topic: topics,
      value: amountVal.toXDR('base64'),
    };
  }

  const TEST_FROM = 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR';
  const TEST_TO = 'GDTYIRQ6WTAYH6XG7FYHR2KPBKB3U3JXBJVXPPZDAYFUWFGG75UCSHSR';

  it('should parse transfer event', () => {
    const event = createMockEvent('transfer', TEST_FROM, TEST_TO, 1000000);
    const parsed = parseTokenEvent(event, TEST_FROM);

    expect(parsed).not.toBeNull();
    expect(parsed.type).toBe('transfer');
    expect(parsed.from).toBe(TEST_FROM);
    expect(parsed.to).toBe(TEST_TO);
    expect(parsed.amount).toBe(BigInt(1000000));
    expect(parsed.direction).toBe('sent');
  });

  it('should parse transfer event as receiver', () => {
    const event = createMockEvent('transfer', TEST_FROM, TEST_TO, 1000000);
    const parsed = parseTokenEvent(event, TEST_TO);

    expect(parsed.direction).toBe('received');
    expect(parsed.counterparty).toBe(TEST_FROM);
  });

  it('should extract SAC metadata from transfer', () => {
    const event = createMockEvent('transfer', TEST_FROM, TEST_TO, 1000000, 'native');
    const parsed = parseTokenEvent(event);

    expect(parsed.sacSymbol).toBe('XLM');
    expect(parsed.sacName).toBe('native');
  });

  it('should parse mint event', () => {
    const event = createMockEvent('mint', TEST_FROM, TEST_TO, 5000000);
    const parsed = parseTokenEvent(event);

    expect(parsed.type).toBe('mint');
    expect(parsed.from).toBe(TEST_FROM); // admin
    expect(parsed.to).toBe(TEST_TO);     // recipient
    expect(parsed.direction).toBe('received');
  });

  it('should parse burn event', () => {
    const typeSymbol = StellarSdk.nativeToScVal('burn', { type: 'symbol' });
    const fromAddr = StellarSdk.Address.fromString(TEST_FROM).toScVal();
    const amountVal = StellarSdk.nativeToScVal(BigInt(1000), { type: 'i128' });

    const event = {
      id: 'test-id',
      txHash: 'abc123',
      ledger: 1000,
      ledgerClosedAt: '2024-01-01T00:00:00Z',
      contractId: 'CABC123',
      topic: [typeSymbol.toXDR('base64'), fromAddr.toXDR('base64')],
      value: amountVal.toXDR('base64'),
    };

    const parsed = parseTokenEvent(event);

    expect(parsed.type).toBe('burn');
    expect(parsed.from).toBe(TEST_FROM);
    expect(parsed.to).toBeNull();
    expect(parsed.direction).toBe('sent');
  });

  it('should return null for non-conforming event (wrong topic types)', () => {
    const typeSymbol = StellarSdk.nativeToScVal('transfer', { type: 'symbol' });
    const invalidTopic = StellarSdk.nativeToScVal('not-an-address', { type: 'string' });

    const event = {
      id: 'test-id',
      txHash: 'abc123',
      ledger: 1000,
      ledgerClosedAt: '2024-01-01T00:00:00Z',
      contractId: 'CABC123',
      topic: [typeSymbol.toXDR('base64'), invalidTopic.toXDR('base64'), invalidTopic.toXDR('base64')],
      value: null,
    };

    const parsed = parseTokenEvent(event);
    expect(parsed).toBeNull();
  });

  it('should return null for unknown event type', () => {
    const event = createMockEvent('unknown_event', TEST_FROM, TEST_TO, 1000);
    const parsed = parseTokenEvent(event);
    expect(parsed).toBeNull();
  });
});

describe('parseFeeEvent', () => {
  it('should parse fee charge event', () => {
    const amountVal = StellarSdk.nativeToScVal(BigInt(100), { type: 'i128' });

    const event = {
      id: 'fee-id',
      txHash: 'abc123',
      ledger: 1000,
      ledgerClosedAt: '2024-01-01T00:00:00Z',
      contractId: 'XLM-CONTRACT',
      value: amountVal.toXDR('base64'),
    };

    const address = 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR';
    const parsed = parseFeeEvent(event, address);

    expect(parsed.type).toBe('fee');
    expect(parsed.from).toBe(address);
    expect(parsed.amount).toBe(BigInt(100));
    expect(parsed.isRefund).toBe(false);
  });

  it('should parse fee refund event (negative amount)', () => {
    const amountVal = StellarSdk.nativeToScVal(BigInt(-50), { type: 'i128' });

    const event = {
      id: 'fee-id',
      txHash: 'abc123',
      ledger: 1000,
      ledgerClosedAt: '2024-01-01T00:00:00Z',
      contractId: 'XLM-CONTRACT',
      value: amountVal.toXDR('base64'),
    };

    const address = 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR';
    const parsed = parseFeeEvent(event, address);

    expect(parsed.isRefund).toBe(true);
    expect(parsed.amount).toBe(BigInt(50)); // absolute value
  });
});

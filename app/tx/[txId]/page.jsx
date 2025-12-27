'use client'

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { getTransaction, initXdrDecoder, decodeXdr, getTokenMetadata, getPoolShareMetadata, cacheSacMetadata } from '@/utils/scan';
import { formatOperations } from '@/utils/scan/operations';
import { rawToDisplay, formatTokenBalance } from '@/utils/stellar/helpers';
import { getAddressPath, formatUnixTimestamp, shortenAddress, formatErrorMessage } from '@/utils/scan/helpers';
import { ScanHeader, AddressDisplay, AddressLink, useNetwork, SkeletonText, SkeletonCard } from '@/app/components';

// SEP-41 token event types
const SEP41_EVENT_TYPES = ['transfer', 'mint', 'burn', 'clawback', 'approve', 'set_admin'];
// CAP-67 fee event type
const FEE_EVENT_TYPE = 'fee';
import '@/app/scan.css';

export default function TransactionPage({ params }) {
  const { txId } = use(params);
  const { network, isLoading: networkLoading } = useNetwork();
  const [txData, setTxData] = useState(null);
  const [decodedXdrs, setDecodedXdrs] = useState({});
  const [operations, setOperations] = useState([]);
  const [events, setEvents] = useState([]);
  const [sourceAccount, setSourceAccount] = useState(null);
  const [sponsorAccount, setSponsorAccount] = useState(null); // For fee bump txs
  const [memo, setMemo] = useState(null); // { type, value }
  const [tokenInfo, setTokenInfo] = useState({}); // { contractId: { symbol, name, decimals } }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedSections, setExpandedSections] = useState({});
  const [xdrReady, setXdrReady] = useState(false);

  useEffect(() => {
    initXdrDecoder().then(() => setXdrReady(true));
  }, []);

  useEffect(() => {
    if (txId && !networkLoading) {
      loadTransaction();
    }
  }, [txId, network, networkLoading]);

  useEffect(() => {
    if (xdrReady && txData) {
      decodeAllXdrs();
    }
  }, [xdrReady, txData]);

  const loadTransaction = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getTransaction(txId);
      setTxData(data);
    } catch (err) {
      console.error('Error loading transaction:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Helper to check if an event is a SEP-41 token event
  const isSep41Event = (event) => {
    if (!event.topics || event.topics.length === 0) return false;
    const firstTopic = event.topics[0];
    if (firstTopic?.symbol && SEP41_EVENT_TYPES.includes(firstTopic.symbol)) {
      return true;
    }
    return false;
  };

  // Helper to check if an event is a CAP-67 fee event
  const isFeeEvent = (event) => {
    if (!event.topics || event.topics.length === 0) return false;
    const firstTopic = event.topics[0];
    return firstTopic?.symbol === FEE_EVENT_TYPE;
  };

  // Helper to check if an event is a token event (SEP-41 or fee)
  const isTokenEvent = (event) => {
    return isSep41Event(event) || isFeeEvent(event);
  };

  // Get the event type from topics
  const getEventType = (event) => {
    if (event.topics?.[0]?.symbol) {
      return event.topics[0].symbol;
    }
    return 'unknown';
  };

  // Parse memo from decoded envelope
  // stellar-xdr-json uses format like: { text: "..." } or { id: "..." } etc.
  const parseMemo = (memoObj) => {
    if (!memoObj) return null;

    // Check for memo_none (empty object or explicit none)
    if (memoObj.none !== undefined || memoObj.memo_none !== undefined || Object.keys(memoObj).length === 0) {
      return null;
    }

    // stellar-xdr-json format: { text: "..." }, { id: "..." }, etc.
    if (memoObj.text !== undefined) {
      return { type: 'text', value: memoObj.text };
    }
    if (memoObj.id !== undefined) {
      return { type: 'id', value: memoObj.id.toString() };
    }
    if (memoObj.hash !== undefined) {
      return { type: 'hash', value: memoObj.hash };
    }
    if (memoObj.return !== undefined) {
      return { type: 'return', value: memoObj.return };
    }

    // Fallback for older memo_* format
    if (memoObj.memo_text !== undefined) {
      return { type: 'text', value: memoObj.memo_text };
    }
    if (memoObj.memo_id !== undefined) {
      return { type: 'id', value: memoObj.memo_id.toString() };
    }
    if (memoObj.memo_hash !== undefined) {
      return { type: 'hash', value: memoObj.memo_hash };
    }
    if (memoObj.memo_return !== undefined) {
      return { type: 'return', value: memoObj.memo_return };
    }

    return null;
  };

  const decodeAllXdrs = async () => {
    if (!txData) return;

    const decoded = {};
    const allEvents = [];

    // Decode envelope and extract operations
    if (txData.envelopeXdr) {
      try {
        decoded.envelope = await decodeXdr('TransactionEnvelope', txData.envelopeXdr);
        // Extract and format operations
        const formattedOps = formatOperations(decoded.envelope);
        setOperations(formattedOps);

        // Extract source account(s) from envelope
        // Fee bump: envelope.tx_fee_bump.tx.fee_source (sponsor) + inner_tx source
        // Regular: envelope.tx.tx.source_account
        if (decoded.envelope.tx_fee_bump) {
          const feeBump = decoded.envelope.tx_fee_bump;
          // Sponsor is the fee bump source
          setSponsorAccount(feeBump.tx?.fee_source || null);
          // Inner tx source account and memo - structure is inner_tx.tx.tx
          const innerTx = feeBump.tx?.inner_tx?.tx?.tx;
          setSourceAccount(innerTx?.source_account || null);
          setMemo(parseMemo(innerTx?.memo));
        } else if (decoded.envelope.tx) {
          // Regular transaction (v1): envelope.tx.tx
          const tx = decoded.envelope.tx.tx;
          setSourceAccount(tx?.source_account || null);
          setMemo(parseMemo(tx?.memo));
          setSponsorAccount(null);
        }
      } catch (e) {
        decoded.envelope = { error: e.message };
        setOperations([]);
      }
    }

    // Decode result
    if (txData.resultXdr) {
      try {
        decoded.result = await decodeXdr('TransactionResult', txData.resultXdr);
      } catch (e) {
        decoded.result = { error: e.message };
      }
    }

    // Decode resultMeta and extract events
    if (txData.resultMetaXdr) {
      try {
        decoded.resultMeta = await decodeXdr('TransactionMeta', txData.resultMetaXdr);

        // Extract events from v4 TransactionMeta
        if (decoded.resultMeta?.v4) {
          // Transaction-level events (fee events are here per CAP-67)
          if (decoded.resultMeta.v4.events) {
            for (const txEvent of decoded.resultMeta.v4.events) {
              // TransactionEvent has { stage, event } structure
              const event = txEvent.event || txEvent;
              allEvents.push({
                type: event.type_,
                contractId: event.contract_id,
                topics: event.body?.v0?.topics || [],
                data: event.body?.v0?.data,
                stage: txEvent.stage, // e.g., 'before_all_txs' or 'after'
              });
            }
          }
          // Operation-level events (SEP-41 token events)
          if (decoded.resultMeta.v4.operations) {
            for (const op of decoded.resultMeta.v4.operations) {
              if (op.events) {
                for (const event of op.events) {
                  allEvents.push({
                    type: event.type_,
                    contractId: event.contract_id,
                    topics: event.body?.v0?.topics || [],
                    data: event.body?.v0?.data,
                  });
                }
              }
            }
          }
        }
        // Extract events from v3 TransactionMeta (soroban_meta) - fallback for older format
        else if (decoded.resultMeta?.v3?.soroban_meta?.events) {
          for (const event of decoded.resultMeta.v3.soroban_meta.events) {
            allEvents.push({
              type: event.type_,
              contractId: event.contract_id,
              topics: event.body?.v0?.topics || [],
              data: event.body?.v0?.data,
            });
          }
        }
      } catch (e) {
        decoded.resultMeta = { error: e.message };
      }
    }

    // Filter to SEP-41 token events and CAP-67 fee events
    const tokenEvents = allEvents.filter(isTokenEvent).map(event => ({
      ...event,
      eventType: getEventType(event),
    }));

    setDecodedXdrs(decoded);
    setEvents(tokenEvents);

    // Extract SAC metadata from events with 4th topic (stellar-xdr-json format)
    // SAC transfers have topics[3] as { string: "SYMBOL:ISSUER" } or { string: "native" }
    const sacMetadataMap = {};
    for (const event of tokenEvents) {
      if (event.contractId && event.topics?.length >= 4) {
        const topic3 = event.topics[3];
        // stellar-xdr-json encodes strings as { string: "value" }
        const assetStr = topic3?.string;
        if (typeof assetStr === 'string') {
          if (assetStr.includes(':')) {
            const symbol = assetStr.split(':')[0];
            sacMetadataMap[event.contractId] = { symbol, name: assetStr, decimals: 7 };
            cacheSacMetadata(event.contractId, symbol, assetStr);
          } else if (assetStr === 'native') {
            sacMetadataMap[event.contractId] = { symbol: 'XLM', name: 'native', decimals: 7 };
            cacheSacMetadata(event.contractId, 'XLM', 'native');
          }
        }
      }
    }

    // Fetch token metadata for unique contract IDs
    const uniqueContractIds = [...new Set(tokenEvents.map(e => e.contractId).filter(Boolean))];
    const metadataPromises = uniqueContractIds.map(async (contractId) => {
      // Use SAC metadata if available (already cached)
      if (sacMetadataMap[contractId]) {
        return { contractId, metadata: sacMetadataMap[contractId] };
      }
      try {
        const metadata = await getTokenMetadata(contractId);
        return { contractId, metadata };
      } catch (e) {
        // Try pool share fallback
        const poolMeta = await getPoolShareMetadata(contractId);
        if (poolMeta) {
          return { contractId, metadata: poolMeta };
        }
        return { contractId, metadata: { symbol: '???', name: 'Unknown', decimals: 7 } };
      }
    });

    const metadataResults = await Promise.all(metadataPromises);
    const infoMap = {};
    for (const { contractId, metadata } of metadataResults) {
      infoMap[contractId] = metadata;
    }
    setTokenInfo(infoMap);
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      // Treat undefined as expanded (true), so first click collapses
      [section]: prev[section] === false
    }));
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'SUCCESS': return 'success';
      case 'FAILED': return 'error';
      case 'NOT_FOUND': return 'warning';
      default: return '';
    }
  };

  const renderJson = (data, maxDepth = 10, currentDepth = 0) => {
    if (currentDepth > maxDepth) return <span className="json-ellipsis">...</span>;

    if (data === null) return <span className="json-null">null</span>;
    if (typeof data === 'boolean') return <span className="json-boolean">{data.toString()}</span>;
    if (typeof data === 'number') return <span className="json-number">{data}</span>;
    if (typeof data === 'string') {
      // Truncate long strings
      const display = data.length > 100 ? data.substring(0, 100) + '...' : data;
      return <span className="json-string">"{display}"</span>;
    }

    if (Array.isArray(data)) {
      if (data.length === 0) return <span>[]</span>;
      return (
        <span>
          {'['}
          <div className="json-indent">
            {data.map((item, i) => (
              <div key={i}>
                {renderJson(item, maxDepth, currentDepth + 1)}
                {i < data.length - 1 && ','}
              </div>
            ))}
          </div>
          {']'}
        </span>
      );
    }

    if (typeof data === 'object') {
      const keys = Object.keys(data);
      if (keys.length === 0) return <span>{'{}'}</span>;
      return (
        <span>
          {'{'}
          <div className="json-indent">
            {keys.map((key, i) => (
              <div key={key}>
                <span className="json-key">"{key}"</span>: {renderJson(data[key], maxDepth, currentDepth + 1)}
                {i < keys.length - 1 && ','}
              </div>
            ))}
          </div>
          {'}'}
        </span>
      );
    }

    return <span>{String(data)}</span>;
  };

  return (
    <div className="scan-page page-tx">
      <ScanHeader />

      <AddressDisplay address={txId} label="Transaction" type="tx" />

      {loading ? (
        <>
          <div className="section-title">Transaction Info</div>
          <div className="tx-meta">
            <div className="tx-meta-item">
              <span className="tx-meta-label">Status</span>
              <SkeletonText width="80px" />
            </div>
            <div className="tx-meta-item">
              <span className="tx-meta-label">Ledger</span>
              <SkeletonText width="100px" />
            </div>
            <div className="tx-meta-item">
              <span className="tx-meta-label">Timestamp</span>
              <SkeletonText width="150px" />
            </div>
            <div className="tx-meta-item">
              <span className="tx-meta-label">Source</span>
              <SkeletonText width="120px" />
            </div>
          </div>
          <div className="section-title">Operations</div>
          <SkeletonCard />
          <div className="section-title">Token Events</div>
          <SkeletonCard />
        </>
      ) : error ? (
        <p className="error">{formatErrorMessage(error)}</p>
      ) : !txData ? (
        <p>transaction not found</p>
      ) : (
        <>
          <div className="section-title">Transaction Info</div>

          <div className="tx-meta">
            <div className="tx-meta-item">
              <span className="tx-meta-label">Status</span>
              <span className={`tx-meta-value ${getStatusColor(txData.status)}`}>{txData.status}</span>
            </div>
            <div className="tx-meta-item">
              <span className="tx-meta-label">Ledger</span>
              <span className="tx-meta-value">{txData.ledger || 'N/A'}</span>
            </div>
            <div className="tx-meta-item">
              <span className="tx-meta-label">Timestamp</span>
              <span className="tx-meta-value">{formatUnixTimestamp(txData.createdAt)}</span>
            </div>
            {sourceAccount && (
              <div className="tx-meta-item">
                <span className="tx-meta-label">Source</span>
                <span className="tx-meta-value">
                  <Link href={getAddressPath(sourceAccount)}>{shortenAddress(sourceAccount)}</Link>
                </span>
              </div>
            )}
            {sponsorAccount && (
              <div className="tx-meta-item">
                <span className="tx-meta-label">Sponsor</span>
                <span className="tx-meta-value">
                  <Link href={getAddressPath(sponsorAccount)}>{shortenAddress(sponsorAccount)}</Link>
                </span>
              </div>
            )}
            {memo && (
              <div className="tx-meta-item tx-meta-full">
                <span className="tx-meta-label">Memo ({memo.type})</span>
                <span className="tx-meta-value">{memo.value}</span>
              </div>
            )}
          </div>

          <div
            className="collapsible-header"
            onClick={() => toggleSection('operations')}
          >
            <span className="collapsible-icon">{expandedSections.operations === false ? '+' : '−'}</span>
            <span>Operations ({operations.length})</span>
          </div>

          {expandedSections.operations !== false && operations.length > 0 && (
            <div className="card" style={{ marginTop: '8px' }}>
              {operations.map((op) => {
                // Render description with linked addresses
                const renderOpDescription = () => {
                  const { description, details } = op;

                  // Collect all addresses from details that appear in the description
                  const addressMap = {};
                  if (details) {
                    for (const [key, value] of Object.entries(details)) {
                      if (typeof value === 'string' && (value.startsWith('G') || value.startsWith('C') || value.startsWith('L')) && value.length >= 56) {
                        // Find the shortened version in description
                        const shortened = value.substring(0, 5);
                        if (description.includes(shortened)) {
                          addressMap[shortened] = value;
                        }
                      }
                    }
                  }

                  // If no addresses to link, return plain description
                  if (Object.keys(addressMap).length === 0) {
                    return description;
                  }

                  // Split description and replace shortened addresses with links
                  const parts = [];
                  let remaining = description;
                  let key = 0;

                  for (const [shortened, fullAddr] of Object.entries(addressMap)) {
                    const idx = remaining.indexOf(shortened);
                    if (idx !== -1) {
                      // Add text before the address
                      if (idx > 0) {
                        parts.push(remaining.substring(0, idx));
                      }
                      // Add the linked address
                      parts.push(<Link key={key++} href={getAddressPath(fullAddr)}>{shortened}</Link>);
                      remaining = remaining.substring(idx + shortened.length);
                    }
                  }
                  // Add any remaining text
                  if (remaining) {
                    parts.push(remaining);
                  }

                  return parts;
                };

                return (
                  <div key={op.index} className="card-item">
                    <span className="op-index">{op.index + 1}.</span>{' '}
                    {renderOpDescription()}
                    {op.sourceAccount && (
                      <span className="text-secondary"> (source: <Link href={getAddressPath(op.sourceAccount)}>{op.sourceAccountShort}</Link>)</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {expandedSections.operations !== false && operations.length === 0 && (
            <p style={{ marginTop: '8px' }} className="text-secondary">{xdrReady ? 'no operations' : 'loading...'}</p>
          )}

          <div
            className="collapsible-header"
            onClick={() => toggleSection('events')}
            style={{ marginTop: '16px' }}
          >
            <span className="collapsible-icon">{expandedSections.events === false ? '+' : '−'}</span>
            <span>Token Events ({events.length})</span>
          </div>

          {expandedSections.events !== false && events.length > 0 && (
            <div className="card" style={{ marginTop: '8px' }}>
              {events.map((event, index) => {
                const token = tokenInfo[event.contractId];
                const symbol = token?.symbol === 'native' ? 'XLM' : (token?.symbol || '???');
                const decimals = token?.decimals ?? 7;

                // Extract raw amount from event data
                const getRawAmount = () => {
                  if (!event.data) return null;

                  const parseNumericScVal = (val) => {
                    if (!val) return null;
                    if (val.i128 !== undefined) return BigInt(val.i128);
                    if (val.u128 !== undefined) return BigInt(val.u128);
                    if (val.i64 !== undefined) return BigInt(val.i64);
                    if (val.u64 !== undefined) return BigInt(val.u64);
                    if (val.i32 !== undefined) return BigInt(val.i32);
                    if (val.u32 !== undefined) return BigInt(val.u32);
                    return null;
                  };

                  if (event.data.map && Array.isArray(event.data.map)) {
                    for (const entry of event.data.map) {
                      if (entry.key?.symbol === 'amount') {
                        return parseNumericScVal(entry.val);
                      }
                    }
                    return null;
                  }

                  return parseNumericScVal(event.data);
                };

                const rawAmount = getRawAmount();
                const formattedAmount = rawAmount
                  ? formatTokenBalance(rawToDisplay(rawAmount, decimals), decimals)
                  : null;

                // Extract addresses from topics based on event type
                const getAddress = (topicIndex) => event.topics?.[topicIndex]?.address;

                let fromAddr = null;
                let toAddr = null;

                switch (event.eventType) {
                  case 'transfer':
                  case 'approve':
                    fromAddr = getAddress(1);
                    toAddr = getAddress(2);
                    break;
                  case 'mint':
                    toAddr = getAddress(1);
                    break;
                  case 'burn':
                  case 'clawback':
                    fromAddr = getAddress(1);
                    break;
                  case 'set_admin':
                    fromAddr = getAddress(1);
                    break;
                  case 'fee':
                    fromAddr = getAddress(1);
                    break;
                  default:
                    fromAddr = getAddress(1);
                    toAddr = getAddress(2);
                }

                // For fee events, check if it's a refund (negative amount)
                const isRefund = event.eventType === 'fee' && rawAmount !== null && rawAmount < 0n;
                const absAmount = rawAmount !== null && rawAmount < 0n ? -rawAmount : rawAmount;
                const displayAmount = event.eventType === 'fee' && absAmount !== null
                  ? formatTokenBalance(rawToDisplay(absAmount, 7), 7)
                  : formattedAmount;

                // Get event type display info
                const getEventTypeInfo = () => {
                  switch (event.eventType) {
                    case 'mint': return { label: 'Mint', dotClass: 'success' };
                    case 'burn': return { label: 'Burn', dotClass: 'danger' };
                    case 'clawback': return { label: 'Clawback', dotClass: 'danger' };
                    case 'approve': return { label: 'Approve', dotClass: '' };
                    case 'set_admin': return { label: 'Set Admin', dotClass: '' };
                    case 'fee': return { label: isRefund ? 'Fee Refund' : 'Fee', dotClass: isRefund ? 'success' : '' };
                    default: return { label: 'Transfer', dotClass: '' };
                  }
                };

                const typeInfo = getEventTypeInfo();

                return (
                  <div key={index} className="card-item">
                    <div className="activity-card-header">
                      <div className="event-type">
                        <span className={`event-dot ${typeInfo.dotClass}`} />
                        {typeInfo.label}
                      </div>
                      <Link href={`/token/${event.contractId}`} className="text-secondary">
                        {symbol}
                      </Link>
                    </div>

                    <div className="activity-addresses">
                      {event.eventType === 'mint' ? (
                        <>→ <AddressLink address={toAddr} /></>
                      ) : event.eventType === 'burn' || event.eventType === 'clawback' ? (
                        <AddressLink address={fromAddr} />
                      ) : event.eventType === 'set_admin' ? (
                        <AddressLink address={fromAddr} />
                      ) : event.eventType === 'fee' ? (
                        <AddressLink address={fromAddr} />
                      ) : (
                        <>
                          <AddressLink address={fromAddr} />
                          {' → '}
                          <AddressLink address={toAddr} />
                        </>
                      )}
                    </div>

                    <div className="activity-footer">
                      <span className={`activity-amount ${
                        event.eventType === 'mint' || isRefund ? 'positive' :
                        event.eventType === 'clawback' || event.eventType === 'burn' || event.eventType === 'fee' ? 'negative' : ''
                      }`}>
                        {(event.eventType === 'mint' || isRefund) && '+'}
                        {(event.eventType === 'burn' || event.eventType === 'clawback' || (event.eventType === 'fee' && !isRefund)) && '-'}
                        {displayAmount || '?'} {symbol}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {expandedSections.events !== false && events.length === 0 && (
            <p style={{ marginTop: '8px' }} className="text-secondary">{xdrReady ? 'no token events' : 'loading...'}</p>
          )}

          <div
            className="collapsible-header"
            onClick={() => toggleSection('xdrs')}
            style={{ marginTop: '16px' }}
          >
            <span className="collapsible-icon">{expandedSections.xdrs ? '−' : '+'}</span>
            <span>Raw Data</span>
          </div>

          {expandedSections.xdrs && (
            !xdrReady ? (
              <p style={{ marginTop: '8px' }} className="text-secondary">loading XDR decoder...</p>
            ) : (
              <div className="card" style={{ marginTop: '8px' }}>
                {/* Envelope */}
                <div className="card-item">
                  <div
                    className="collapsible-header nested"
                    onClick={() => toggleSection('envelope')}
                  >
                    <span className="collapsible-icon">{expandedSections.envelope ? '−' : '+'}</span>
                    <span>TransactionEnvelope</span>
                  </div>
                  {expandedSections.envelope && (
                    <div className="xdr-content">
                      {decodedXdrs.envelope ? (
                        <pre className="json-viewer">{renderJson(decodedXdrs.envelope)}</pre>
                      ) : (
                        <p className="text-secondary">decoding...</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Result */}
                <div className="card-item">
                  <div
                    className="collapsible-header nested"
                    onClick={() => toggleSection('result')}
                  >
                    <span className="collapsible-icon">{expandedSections.result ? '−' : '+'}</span>
                    <span>TransactionResult</span>
                  </div>
                  {expandedSections.result && (
                    <div className="xdr-content">
                      {decodedXdrs.result ? (
                        <pre className="json-viewer">{renderJson(decodedXdrs.result)}</pre>
                      ) : (
                        <p className="text-secondary">decoding...</p>
                      )}
                    </div>
                  )}
                </div>

                {/* ResultMeta */}
                <div className="card-item">
                  <div
                    className="collapsible-header nested"
                    onClick={() => toggleSection('resultMeta')}
                  >
                    <span className="collapsible-icon">{expandedSections.resultMeta ? '−' : '+'}</span>
                    <span>TransactionMeta</span>
                  </div>
                  {expandedSections.resultMeta && (
                    <div className="xdr-content">
                      {decodedXdrs.resultMeta ? (
                        <pre className="json-viewer">{renderJson(decodedXdrs.resultMeta)}</pre>
                      ) : (
                        <p className="text-secondary">decoding...</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </>
      )}

      <p style={{ marginTop: '24px' }}>
        <Link href="/">← new search</Link>
      </p>
    </div>
  );
}

'use client'

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { getTransaction, initXdrDecoder, decodeXdr, getTokenMetadata, getPoolShareMetadata } from '@/utils/scan';
import { formatOperations } from '@/utils/scan/operations';
import { rawToDisplay, formatTokenBalance } from '@/utils/stellar/helpers';
import { getAddressPath, formatUnixTimestamp } from '@/utils/scan/helpers';
import { ScanHeader, AddressDisplay, useNetwork } from '@/app/components';

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

    // Fetch token metadata for unique contract IDs
    const uniqueContractIds = [...new Set(tokenEvents.map(e => e.contractId).filter(Boolean))];
    const metadataPromises = uniqueContractIds.map(async (contractId) => {
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
      [section]: !prev[section]
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
    <div className="scan-page">
      <ScanHeader />

      <hr />

      <AddressDisplay address={txId} label="tx:" type="tx" />

      <hr />

      {loading ? (
        <p>loading...</p>
      ) : error ? (
        <p className="error">error: {error}</p>
      ) : !txData ? (
        <p>transaction not found</p>
      ) : (
        <>
          <h2>transaction info</h2>

          <p><strong>status:</strong> <span className={getStatusColor(txData.status)}>{txData.status}</span></p>
          <p><strong>ledger:</strong> {txData.ledger || 'N/A'}</p>
          <p><strong>timestamp:</strong> {formatUnixTimestamp(txData.createdAt)}</p>
          {sourceAccount && (
            <p><strong>source:</strong> <Link href={getAddressPath(sourceAccount)}>{sourceAccount.substring(0, 6)}...{sourceAccount.substring(sourceAccount.length - 4)}</Link></p>
          )}
          {sponsorAccount && (
            <p><strong>sponsor:</strong> <Link href={getAddressPath(sponsorAccount)}>{sponsorAccount.substring(0, 6)}...{sponsorAccount.substring(sponsorAccount.length - 4)}</Link></p>
          )}
          {memo && (
            <p><strong>memo ({memo.type}):</strong> {memo.value}</p>
          )}

          <hr />

          <p>
            <a href="#" onClick={(e) => { e.preventDefault(); toggleSection('operations'); }}>
              {expandedSections.operations === false ? '[+]' : '[-]'} operations ({operations.length})
            </a>
          </p>

          {expandedSections.operations !== false && operations.length > 0 && (
            <div className="operations-list">
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
                  <p key={op.index} className="operation-item">
                    <span className="op-index">{op.index + 1}.</span>{' '}
                    {renderOpDescription()}
                    {op.sourceAccount && (
                      <span className="op-source"> (source: <Link href={getAddressPath(op.sourceAccount)}>{op.sourceAccountShort}</Link>)</span>
                    )}
                  </p>
                );
              })}
            </div>
          )}

          {expandedSections.operations !== false && operations.length === 0 && (
            <p>{xdrReady ? 'no operations' : 'loading...'}</p>
          )}

          <hr />

          <p>
            <a href="#" onClick={(e) => { e.preventDefault(); toggleSection('events'); }}>
              {expandedSections.events === false ? '[+]' : '[-]'} token events ({events.length})
            </a>
          </p>

          {expandedSections.events !== false && events.length > 0 && (
            <div className="events-list">
              {events.map((event, index) => {
                const token = tokenInfo[event.contractId];
                const symbol = token?.symbol === 'native' ? 'XLM' : (token?.symbol || '???');
                const decimals = token?.decimals ?? 7;

                // Extract raw amount from event data
                // stellar-xdr-json can encode data as:
                // 1. Direct value: { i128: "1" } or { i64: "1" }
                // 2. Map with amount field: { map: [{ key: { symbol: "amount" }, val: { i128: "1" } }] }
                const getRawAmount = () => {
                  if (!event.data) return null;

                  // Helper to parse numeric ScVal from stellar-xdr-json format
                  const parseNumericScVal = (val) => {
                    if (!val) return null;
                    // stellar-xdr-json encodes i128/u128 as string numbers
                    if (val.i128 !== undefined) return BigInt(val.i128);
                    if (val.u128 !== undefined) return BigInt(val.u128);
                    if (val.i64 !== undefined) return BigInt(val.i64);
                    if (val.u64 !== undefined) return BigInt(val.u64);
                    if (val.i32 !== undefined) return BigInt(val.i32);
                    if (val.u32 !== undefined) return BigInt(val.u32);
                    return null;
                  };

                  // Check if data is a map (SEP-41 muxed transfer format)
                  if (event.data.map && Array.isArray(event.data.map)) {
                    for (const entry of event.data.map) {
                      if (entry.key?.symbol === 'amount') {
                        return parseNumericScVal(entry.val);
                      }
                    }
                    return null;
                  }

                  // Direct value (non-muxed transfer)
                  return parseNumericScVal(event.data);
                };

                const rawAmount = getRawAmount();
                const formattedAmount = rawAmount
                  ? formatTokenBalance(rawToDisplay(rawAmount, decimals), decimals)
                  : null;

                // Extract addresses from topics based on event type
                // SEP-41 topic structure varies by event:
                // - transfer: [symbol, from_addr, to_addr]
                // - mint: [symbol, to_addr, ...]
                // - burn/clawback: [symbol, from_addr, ...]
                // - approve: [symbol, from_addr, spender_addr]
                // - set_admin: [symbol, new_admin_addr]
                const getAddress = (topicIndex) => event.topics?.[topicIndex]?.address;
                const minify = (addr) => addr ? addr.substring(0, 5) : null;

                // Helper to render address with appropriate linking
                // B... addresses are claimable balance IDs, not linkable
                const renderAddr = (addr) => {
                  if (!addr) return '?';
                  if (addr.startsWith('B')) {
                    return <span className="text-secondary">{minify(addr)}</span>;
                  }
                  return <Link href={getAddressPath(addr)}>{minify(addr)}</Link>;
                };

                // Determine from/to addresses based on event type
                let fromAddr = null;
                let toAddr = null;

                switch (event.eventType) {
                  case 'transfer':
                  case 'approve':
                    fromAddr = getAddress(1);
                    toAddr = getAddress(2);
                    break;
                  case 'mint':
                    toAddr = getAddress(1); // mint only has recipient
                    break;
                  case 'burn':
                  case 'clawback':
                    fromAddr = getAddress(1); // burn/clawback only has source
                    break;
                  case 'set_admin':
                    fromAddr = getAddress(1); // new admin address
                    break;
                  case 'fee':
                    fromAddr = getAddress(1); // account paying/receiving the fee
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

                // Render human-readable event description
                const renderEventDescription = () => {
                  const symbolLink = <Link href={`/token/${event.contractId}`}>{symbol}</Link>;

                  switch (event.eventType) {
                    case 'fee':
                      return (
                        <p className="event-description">
                          <span className={isRefund ? 'success' : ''}>
                            {isRefund ? '+' : '-'}{displayAmount || '?'} XLM
                          </span>
                          {' '}
                          <span style={{ color: 'var(--text-secondary)' }}>
                            ({isRefund ? 'refund' : 'fee'})
                          </span>
                          {' '}
                          {fromAddr ? renderAddr(fromAddr) : ''}
                        </p>
                      );
                    case 'transfer':
                      return (
                        <p className="event-description">
                          {symbolLink}: transfer {formattedAmount || '?'} from{' '}
                          {renderAddr(fromAddr)}{' '}
                          to {renderAddr(toAddr)}
                        </p>
                      );
                    case 'mint':
                      return (
                        <p className="event-description">
                          {symbolLink}: mint {formattedAmount || '?'} to{' '}
                          {renderAddr(toAddr)}
                        </p>
                      );
                    case 'burn':
                      return (
                        <p className="event-description">
                          {symbolLink}: burn {formattedAmount || '?'} from{' '}
                          {renderAddr(fromAddr)}
                        </p>
                      );
                    case 'clawback':
                      return (
                        <p className="event-description">
                          {symbolLink}: clawback {formattedAmount || '?'} from{' '}
                          {renderAddr(fromAddr)}
                        </p>
                      );
                    case 'approve':
                      return (
                        <p className="event-description">
                          {symbolLink}: approve {formattedAmount || '?'} from{' '}
                          {renderAddr(fromAddr)}{' '}
                          to {renderAddr(toAddr)}
                        </p>
                      );
                    case 'set_admin':
                      return (
                        <p className="event-description">
                          {symbolLink}: set_admin{' '}
                          {renderAddr(fromAddr)}
                        </p>
                      );
                    default:
                      return (
                        <p className="event-description">
                          {symbolLink}: {event.eventType} {formattedAmount || ''}
                        </p>
                      );
                  }
                };

                return (
                  <div key={index} className="event-item">
                    {renderEventDescription()}
                  </div>
                );
              })}
            </div>
          )}

          {expandedSections.events !== false && events.length === 0 && (
            <p>{xdrReady ? 'no token events' : 'loading...'}</p>
          )}

          <hr />

          <p>
            <a href="#" onClick={(e) => { e.preventDefault(); toggleSection('xdrs'); }}>
              {expandedSections.xdrs ? '[-]' : '[+]'} decoded XDRs
            </a>
          </p>

          {expandedSections.xdrs && (
            !xdrReady ? (
              <p>loading XDR decoder...</p>
            ) : (
              <>
                {/* Envelope */}
                <div className="xdr-section">
                  <p>
                    <a href="#" onClick={(e) => { e.preventDefault(); toggleSection('envelope'); }}>
                      {expandedSections.envelope ? '[-]' : '[+]'} TransactionEnvelope
                    </a>
                  </p>
                  {expandedSections.envelope && (
                    <div className="xdr-content">
                      {decodedXdrs.envelope ? (
                        <pre className="json-viewer">{renderJson(decodedXdrs.envelope)}</pre>
                      ) : (
                        <p>decoding...</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Result */}
                <div className="xdr-section">
                  <p>
                    <a href="#" onClick={(e) => { e.preventDefault(); toggleSection('result'); }}>
                      {expandedSections.result ? '[-]' : '[+]'} TransactionResult
                    </a>
                  </p>
                  {expandedSections.result && (
                    <div className="xdr-content">
                      {decodedXdrs.result ? (
                        <pre className="json-viewer">{renderJson(decodedXdrs.result)}</pre>
                      ) : (
                        <p>decoding...</p>
                      )}
                    </div>
                  )}
                </div>

                {/* ResultMeta */}
                <div className="xdr-section">
                  <p>
                    <a href="#" onClick={(e) => { e.preventDefault(); toggleSection('resultMeta'); }}>
                      {expandedSections.resultMeta ? '[-]' : '[+]'} TransactionMeta
                    </a>
                  </p>
                  {expandedSections.resultMeta && (
                    <div className="xdr-content">
                      {decodedXdrs.resultMeta ? (
                        <pre className="json-viewer">{renderJson(decodedXdrs.resultMeta)}</pre>
                      ) : (
                        <p>decoding...</p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )
          )}
        </>
      )}

      <hr />

      <p>
        <Link href="/">new search</Link>
      </p>
    </div>
  );
}

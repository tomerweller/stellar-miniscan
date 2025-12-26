'use client'

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { getTransaction, initXdrDecoder, decodeXdr, getTokenMetadata, getPoolShareMetadata } from '@/utils/scan';
import { formatOperations } from '@/utils/scan/operations';
import { rawToDisplay, formatTokenBalance } from '@/utils/stellar/helpers';
import { getAddressPath } from '@/utils/scan/helpers';
import { ScanHeader, useNetwork } from '@/app/components';

// SEP-41 token event types
const SEP41_EVENT_TYPES = ['transfer', 'mint', 'burn', 'clawback', 'approve', 'set_admin'];
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
  const [tokenInfo, setTokenInfo] = useState({}); // { contractId: { symbol, name, decimals } }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
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

  // Get the event type from topics
  const getEventType = (event) => {
    if (event.topics?.[0]?.symbol) {
      return event.topics[0].symbol;
    }
    return 'unknown';
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
          // Inner tx source account - structure is inner_tx.tx.tx.source_account
          const innerTx = feeBump.tx?.inner_tx?.tx?.tx;
          setSourceAccount(innerTx?.source_account || null);
        } else if (decoded.envelope.tx) {
          // Regular transaction (v1): envelope.tx.tx.source_account
          setSourceAccount(decoded.envelope.tx.tx?.source_account || null);
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
        if (decoded.resultMeta?.v4?.operations) {
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
        // Extract events from v3 TransactionMeta (soroban_meta)
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

    // Filter to only SEP-41 token events
    const tokenEvents = allEvents.filter(isSep41Event).map(event => ({
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

  const copyToClipboard = () => {
    navigator.clipboard.writeText(txId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shortenHash = (hash) => {
    if (!hash || hash.length < 16) return hash;
    return `${hash.substring(0, 8)}....${hash.substring(hash.length - 8)}`;
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    // RPC returns Unix timestamp in seconds as STRING, JS needs milliseconds
    const seconds = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
    return new Date(seconds * 1000).toLocaleString();
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
      <h1>LUMENITOS SCAN</h1>
      <p className={`network-label ${config.isTestnet ? 'testnet' : 'mainnet'}`}>
        {config.isTestnet ? config.stellar.network : 'MAINNET'}
      </p>
      <p className="subtitle">mini token explorer</p>

      <hr />

      <p>
        <strong>tx:</strong> {shortenHash(txId)}{' '}
        (<a href="#" onClick={(e) => { e.preventDefault(); copyToClipboard(); }}>
          {copied ? 'copied!' : 'copy'}
        </a>)
        {' | '}
        <a href={`${config.stellar.explorerUrl}/tx/${txId}`} target="_blank" rel="noopener noreferrer">
          stellar.expert
        </a>
      </p>

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
          <p><strong>timestamp:</strong> {formatTimestamp(txData.createdAt)}</p>
          {sourceAccount && (
            <p><strong>source:</strong> <Link href={getAddressPath(sourceAccount)}>{sourceAccount.substring(0, 6)}...{sourceAccount.substring(sourceAccount.length - 4)}</Link></p>
          )}
          {sponsorAccount && (
            <p><strong>sponsor:</strong> <Link href={getAddressPath(sponsorAccount)}>{sponsorAccount.substring(0, 6)}...{sponsorAccount.substring(sponsorAccount.length - 4)}</Link></p>
          )}

          <hr />

          <h2>operations ({operations.length})</h2>

          {operations.length > 0 ? (
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
          ) : (
            <p>{xdrReady ? 'no operations' : 'loading...'}</p>
          )}

          <hr />

          <h2>token events ({events.length})</h2>

          {events.length > 0 ? (
            <div className="events-list">
              {events.map((event, index) => {
                const token = tokenInfo[event.contractId];
                const symbol = token?.symbol === 'native' ? 'XLM' : (token?.symbol || '???');
                const decimals = token?.decimals ?? 7;

                // Extract raw amount from event data
                const getRawAmount = () => {
                  if (!event.data) return null;
                  if (event.data.i128) return event.data.i128;
                  if (event.data.u128) return event.data.u128;
                  if (event.data.i64) return event.data.i64;
                  if (event.data.u64) return event.data.u64;
                  if (event.data.i32) return String(event.data.i32);
                  if (event.data.u32) return String(event.data.u32);
                  return null;
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
                const addrLink = (addr) => getAddressPath(addr);

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
                  default:
                    fromAddr = getAddress(1);
                    toAddr = getAddress(2);
                }

                // Render human-readable event description
                const renderEventDescription = () => {
                  const symbolLink = <Link href={`/token/${event.contractId}`}>{symbol}</Link>;

                  switch (event.eventType) {
                    case 'transfer':
                      return (
                        <p className="event-description">
                          {symbolLink}: transfer {formattedAmount || '?'} from{' '}
                          {fromAddr ? <Link href={addrLink(fromAddr)}>{minify(fromAddr)}</Link> : '?'}{' '}
                          to {toAddr ? <Link href={addrLink(toAddr)}>{minify(toAddr)}</Link> : '?'}
                        </p>
                      );
                    case 'mint':
                      return (
                        <p className="event-description">
                          {symbolLink}: mint {formattedAmount || '?'} to{' '}
                          {toAddr ? <Link href={addrLink(toAddr)}>{minify(toAddr)}</Link> : '?'}
                        </p>
                      );
                    case 'burn':
                      return (
                        <p className="event-description">
                          {symbolLink}: burn {formattedAmount || '?'} from{' '}
                          {fromAddr ? <Link href={addrLink(fromAddr)}>{minify(fromAddr)}</Link> : '?'}
                        </p>
                      );
                    case 'clawback':
                      return (
                        <p className="event-description">
                          {symbolLink}: clawback {formattedAmount || '?'} from{' '}
                          {fromAddr ? <Link href={addrLink(fromAddr)}>{minify(fromAddr)}</Link> : '?'}
                        </p>
                      );
                    case 'approve':
                      return (
                        <p className="event-description">
                          {symbolLink}: approve {formattedAmount || '?'} from{' '}
                          {fromAddr ? <Link href={addrLink(fromAddr)}>{minify(fromAddr)}</Link> : '?'}{' '}
                          to {toAddr ? <Link href={addrLink(toAddr)}>{minify(toAddr)}</Link> : '?'}
                        </p>
                      );
                    case 'set_admin':
                      return (
                        <p className="event-description">
                          {symbolLink}: set_admin{' '}
                          {fromAddr ? <Link href={addrLink(fromAddr)}>{minify(fromAddr)}</Link> : '?'}
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
          ) : (
            <p>{xdrReady ? 'no token events' : 'loading...'}</p>
          )}

          <hr />

          <h2>decoded XDRs</h2>

          {!xdrReady ? (
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

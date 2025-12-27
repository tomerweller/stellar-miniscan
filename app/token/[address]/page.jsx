'use client'

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  isValidAddress,
  getTokenMetadata,
  getTokenTransfers,
  cacheSacMetadata,
} from '@/utils/scan';
import { rawToDisplay, formatTokenBalance } from '@/utils/stellar/helpers';
import {
  ScanHeader,
  AddressDisplay,
  AddressLink,
  useNetwork,
  SkeletonActivity,
  SkeletonText,
} from '@/app/components';
import { formatRelativeTime } from '@/utils/scan/helpers';
import '@/app/scan.css';

export default function TokenPage({ params }) {
  const { address } = use(params);
  const { network, isLoading: networkLoading } = useNetwork();
  const [metadata, setMetadata] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visibleCount, setVisibleCount] = useState(10);

  const isContract = address?.startsWith('C');
  const isValid = isValidAddress(address) && isContract;

  useEffect(() => {
    if (isValid && !networkLoading) {
      loadData();
    }
  }, [address, isValid, network, networkLoading]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    setVisibleCount(10);

    try {
      // Fetch metadata and transfers in parallel
      // Metadata may fail for non-token contracts - that's ok
      const [tokenMetadata, tokenTransfers] = await Promise.allSettled([
        getTokenMetadata(address),
        getTokenTransfers(address),
      ]);

      // Get transfers first so we can extract SAC metadata if needed
      const transferList = tokenTransfers.status === 'fulfilled' ? tokenTransfers.value : [];
      setTransfers(transferList);

      // Use metadata if available
      if (tokenMetadata.status === 'fulfilled') {
        setMetadata(tokenMetadata.value);
      } else {
        // Metadata fetch failed - try to extract from SAC transfer events
        // SAC transfers have sacSymbol and sacName in the 4th topic
        const sacTransfer = transferList.find(t => t.sacSymbol);
        if (sacTransfer) {
          // Cache and use SAC metadata
          cacheSacMetadata(address, sacTransfer.sacSymbol, sacTransfer.sacName);
          setMetadata({
            symbol: sacTransfer.sacSymbol,
            name: sacTransfer.sacName || sacTransfer.sacSymbol,
            decimals: 7,
          });
        } else {
          // No SAC metadata available - show unknown
          setMetadata({ symbol: '???', name: 'Unknown', decimals: 7 });
        }
      }
    } catch (err) {
      console.error('Error loading token data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatAmount = (amount) => {
    const decimals = metadata?.decimals ?? 7;
    const displayAmount = rawToDisplay(amount, decimals);
    return formatTokenBalance(displayAmount, decimals);
  };

  const getSymbol = () => {
    if (!metadata) return '???';
    return metadata.symbol === 'native' ? 'XLM' : metadata.symbol;
  };

  // Parse SAC token name to extract issuer info
  // SAC names are in format "CODE:ISSUER_ADDRESS" or "native"
  const parseTokenName = () => {
    if (!metadata?.name) return { displayName: null, issuer: null };

    const name = metadata.name;
    const symbol = metadata.symbol;

    // Native XLM
    if (name === 'native' || symbol === 'native') {
      return { displayName: 'Stellar Native Asset', issuer: null };
    }

    // SAC format: CODE:ISSUER (e.g., "USDC:GA5ZSEJYB37...")
    if (name.includes(':')) {
      const [code, issuer] = name.split(':');
      if (issuer && issuer.startsWith('G') && issuer.length >= 56) {
        // Don't show displayName if it matches the symbol
        const showName = code !== symbol ? code : null;
        return { displayName: showName, issuer };
      }
    }

    // Regular token name - show if different from symbol
    if (name !== symbol) {
      // Truncate if too long
      const displayName = name.length > 40 ? name.substring(0, 40) + '...' : name;
      return { displayName, issuer: null };
    }

    return { displayName: null, issuer: null };
  };

  // Get event type display info
  const getEventTypeInfo = (type) => {
    switch (type) {
      case 'mint': return { label: 'Mint', dotClass: 'success' };
      case 'burn': return { label: 'Burn', dotClass: 'danger' };
      case 'clawback': return { label: 'Clawback', dotClass: 'danger' };
      default: return { label: 'Transfer', dotClass: '' };
    }
  };

  if (!isValid) {
    return (
      <div className="scan-page">
        <ScanHeader />
        <p className="error">
          {!address?.startsWith('C')
            ? 'Token view requires a contract address (C...)'
            : `Invalid contract address: ${address}`}
        </p>
        <p>
          <Link href="/">back to search</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="scan-page page-token">
      <ScanHeader />

      {loading ? (
        <>
          <div className="token-hero">
            <div className="token-hero-main">
              <SkeletonText width="80px" />
              <SkeletonText width="150px" />
            </div>
            <div className="token-hero-meta">
              <SkeletonText width="100px" />
            </div>
          </div>
          <AddressDisplay address={address} label="Contract" />
          <div className="section-title">Recent Activity</div>
          <SkeletonActivity count={5} />
        </>
      ) : error ? (
        <>
          <AddressDisplay address={address} label="Token" />
          <p className="error">
            {error.includes('not found') ? 'token contract not found' : `error: ${error}`}
          </p>
        </>
      ) : (
        <>
          {(() => {
            const { displayName, issuer } = parseTokenName();
            return (
              <div className="token-hero">
                <div className="token-symbol">{getSymbol()}</div>
                {displayName && <div className="token-name">{displayName}</div>}
                {issuer && (
                  <div className="token-issuer">
                    Issued by <Link href={`/account/${issuer}`}>{issuer.substring(0, 4)}...{issuer.substring(issuer.length - 4)}</Link>
                  </div>
                )}
                <div className="token-hero-meta">
                  <span className="token-decimals">{metadata?.decimals ?? 7} decimals</span>
                </div>
              </div>
            );
          })()}

          <AddressDisplay address={address} label="Contract" />

          <p style={{ marginTop: '8px' }}>
            <Link href={`/contract/${address}`}>switch to contract view →</Link>
          </p>

          <div className="section-title">
            Recent Activity
            <a
              href="#"
              className="refresh-btn"
              onClick={(e) => { e.preventDefault(); setVisibleCount(10); loadData(); }}
            >
              refresh ↻
            </a>
          </div>

          {transfers.length === 0 ? (
            <p>no activity found</p>
          ) : (() => {
            // Group transfers by transaction hash
            const txGroups = [];
            const txMap = new Map();
            for (const t of transfers) {
              if (!txMap.has(t.txHash)) {
                const group = { txHash: t.txHash, timestamp: t.timestamp, events: [] };
                txMap.set(t.txHash, group);
                txGroups.push(group);
              }
              txMap.get(t.txHash).events.push(t);
            }

            return (
              <>
                <div className="card">
                  {txGroups.slice(0, visibleCount).map((group) => (
                    <div key={group.txHash} className="card-item">
                      {group.events.map((t, eventIndex) => {
                        const typeInfo = getEventTypeInfo(t.type);

                        return (
                          <div key={eventIndex} style={{ marginBottom: eventIndex < group.events.length - 1 ? '12px' : '0' }}>
                            <div className="activity-card-header">
                              <div className="event-type">
                                <span className={`event-dot ${typeInfo.dotClass}`} />
                                {typeInfo.label}
                              </div>
                              {eventIndex === 0 && (
                                <span className="activity-timestamp" title={new Date(group.timestamp).toLocaleString()}>
                                  {formatRelativeTime(group.timestamp)}
                                </span>
                              )}
                            </div>

                            <div className="activity-addresses">
                              {t.type === 'mint' ? (
                                <>→ <AddressLink address={t.to} /></>
                              ) : t.type === 'burn' ? (
                                <AddressLink address={t.from} />
                              ) : t.type === 'clawback' ? (
                                <AddressLink address={t.from} />
                              ) : (
                                <>
                                  <AddressLink address={t.from} />
                                  {' → '}
                                  <AddressLink address={t.to} />
                                </>
                              )}
                            </div>

                            <div className="activity-footer">
                              <span className={`activity-amount ${
                                t.type === 'mint' ? 'positive' :
                                t.type === 'clawback' || t.type === 'burn' ? 'negative' : ''
                              }`}>
                                {t.type === 'mint' && '+'}
                                {(t.type === 'burn' || t.type === 'clawback') && '-'}
                                {formatAmount(t.amount)} {getSymbol()}
                              </span>
                              {eventIndex === group.events.length - 1 && (
                                <Link href={`/tx/${group.txHash}`} className="activity-tx-link">
                                  tx:{group.txHash?.substring(0, 4)}
                                </Link>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {visibleCount < txGroups.length && (
                  <p style={{ textAlign: 'center' }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); setVisibleCount(v => v + 10); }}>
                      show more
                    </a>
                  </p>
                )}
              </>
            );
          })()}
        </>
      )}

      <p style={{ marginTop: '24px' }}>
        <Link href="/">← new search</Link>
      </p>
    </div>
  );
}

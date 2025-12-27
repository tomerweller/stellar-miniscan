'use client'

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  isValidAddress,
  getLiquidityPoolData,
  getRecentTransfers,
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
import { formatRelativeTime, formatErrorMessage } from '@/utils/scan/helpers';
import '@/app/scan.css';

export default function LiquidityPoolPage({ params }) {
  const { address } = use(params);
  const router = useRouter();
  const { network, isLoading: networkLoading } = useNetwork();
  const [poolData, setPoolData] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [tokenInfo, setTokenInfo] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visibleCount, setVisibleCount] = useState(10);

  const isPool = address?.startsWith('L');
  const isValid = isValidAddress(address) && isPool;

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
      // Fetch pool data and transfers in parallel
      const [pool, poolTransfers] = await Promise.all([
        getLiquidityPoolData(address),
        getRecentTransfers(address),
      ]);

      if (!pool) {
        setError('Liquidity pool not found');
        setLoading(false);
        return;
      }

      setPoolData(pool);
      setTransfers(poolTransfers);

      // Cache SAC metadata from transfer events
      for (const t of poolTransfers) {
        if (t.sacSymbol && t.contractId) {
          cacheSacMetadata(t.contractId, t.sacSymbol, t.sacName);
        }
      }

      // Build token info map from pool assets for transfer formatting
      const infoMap = {
        [pool.assetA.contractId]: { symbol: pool.assetA.code, decimals: 7 },
        [pool.assetB.contractId]: { symbol: pool.assetB.code, decimals: 7 },
      };
      setTokenInfo(infoMap);
    } catch (err) {
      console.error('Error loading liquidity pool data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatReserve = (amount) => {
    // Stellar classic assets have 7 decimal places
    const displayAmount = rawToDisplay(amount, 7);
    return formatTokenBalance(displayAmount, 7);
  };

  const formatFee = (feeBps) => {
    // Fee is in basis points (30 = 0.3%)
    return `${(feeBps / 100).toFixed(2)}%`;
  };

  const formatPoolShares = (shares) => {
    const displayAmount = rawToDisplay(shares, 7);
    return formatTokenBalance(displayAmount, 2);
  };

  // Format transfer for display with token symbol
  const formatTransfer = (t) => {
    const info = tokenInfo[t.contractId];
    const decimals = info?.decimals ?? 7;
    const displayAmount = rawToDisplay(t.amount, decimals);
    return {
      ...t,
      formattedAmount: formatTokenBalance(displayAmount, decimals),
      // Use sacSymbol from event topic if available (SAC transfers), otherwise fall back to tokenInfo
      symbol: t.sacSymbol || info?.symbol || '???',
    };
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
          {!address?.startsWith('L')
            ? 'Liquidity pool view requires an L... address'
            : `Invalid liquidity pool address: ${address}`}
        </p>
        <p>
          <Link href="/">back to search</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="scan-page page-lp">
      <ScanHeader />

      <AddressDisplay address={address} label="Liquidity Pool" />

      {loading ? (
        <>
          <div className="section-title">Pool Info</div>
          <div className="tx-meta">
            <div className="tx-meta-item">
              <span className="tx-meta-label">Type</span>
              <SkeletonText width="120px" />
            </div>
            <div className="tx-meta-item">
              <span className="tx-meta-label">Fee</span>
              <SkeletonText width="60px" />
            </div>
            <div className="tx-meta-item">
              <span className="tx-meta-label">Pool Shares</span>
              <SkeletonText width="100px" />
            </div>
            <div className="tx-meta-item">
              <span className="tx-meta-label">Trustlines</span>
              <SkeletonText width="50px" />
            </div>
          </div>
          <div className="section-title">Reserves</div>
          <div className="balance-list">
            <div className="balance-card">
              <SkeletonText width="60px" />
              <SkeletonText width="100px" />
            </div>
            <div className="balance-card">
              <SkeletonText width="60px" />
              <SkeletonText width="100px" />
            </div>
          </div>
          <div className="section-title">Recent Activity</div>
          <SkeletonActivity count={3} />
        </>
      ) : error ? (
        <p className="error">{formatErrorMessage(error)}</p>
      ) : (
        <>
          <div className="section-title">Pool Info</div>

          <div className="tx-meta">
            <div className="tx-meta-item">
              <span className="tx-meta-label">Type</span>
              <span className="tx-meta-value">Constant Product (AMM)</span>
            </div>
            <div className="tx-meta-item">
              <span className="tx-meta-label">Fee</span>
              <span className="tx-meta-value">{formatFee(poolData.fee)}</span>
            </div>
            <div className="tx-meta-item">
              <span className="tx-meta-label">Pool Shares</span>
              <span className="tx-meta-value">{formatPoolShares(poolData.totalPoolShares)}</span>
            </div>
            <div className="tx-meta-item">
              <span className="tx-meta-label">Trustlines</span>
              <span className="tx-meta-value">{poolData.trustlineCount}</span>
            </div>
          </div>

          <div className="section-title">Reserves</div>

          <div className="balance-list">
            <Link href={`/token/${poolData.assetA.contractId}`} className="balance-card">
              <div className="balance-card-header">
                <span className="balance-symbol">{poolData.assetA.code}</span>
              </div>
              <div className="balance-amount">{formatReserve(poolData.assetA.reserve)}</div>
            </Link>

            <Link href={`/token/${poolData.assetB.contractId}`} className="balance-card">
              <div className="balance-card-header">
                <span className="balance-symbol">{poolData.assetB.code}</span>
              </div>
              <div className="balance-amount">{formatReserve(poolData.assetB.reserve)}</div>
            </Link>
          </div>

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
                    <Link href={`/tx/${group.txHash}`} key={group.txHash} className="card-item">
                      {group.events.map((t, eventIndex) => {
                        const ft = formatTransfer(t);
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
                                <>→ <AddressLink address={t.to} nested /></>
                              ) : t.type === 'burn' || t.type === 'clawback' ? (
                                <AddressLink address={t.from} nested />
                              ) : (
                                <>
                                  <AddressLink address={t.from} nested />
                                  {' → '}
                                  <AddressLink address={t.to} nested />
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
                                {ft.formattedAmount}{' '}
                                <span
                                  className="nested-link"
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/token/${t.contractId}`); }}
                                >{ft.symbol}</span>
                              </span>
                              {eventIndex === group.events.length - 1 && (
                                <span className="activity-tx-link">
                                  tx:{group.txHash?.substring(0, 4)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </Link>
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

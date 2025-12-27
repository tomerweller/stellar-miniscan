'use client'

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  isValidAddress,
  getTokenBalance,
  getTokenMetadata,
  getContractInvocations,
  getRecentTransfers,
  extractContractIds,
  cacheSacMetadata,
} from '@/utils/scan';
import { rawToDisplay, formatTokenBalance } from '@/utils/stellar/helpers';
import {
  formatRelativeTime,
  formatTopicValue,
  shortenAddressSmall,
} from '@/utils/scan/helpers';
import { useNetwork, ScanHeader, AddressDisplay, AddressLink, SkeletonActivity, SkeletonBalance } from '@/app/components';
import '@/app/scan.css';

export default function ContractPage({ params }) {
  const { address } = use(params);
  const { network, isLoading: networkLoading } = useNetwork();
  const [balances, setBalances] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [invocations, setInvocations] = useState([]);
  const [tokenInfo, setTokenInfo] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visibleTransfers, setVisibleTransfers] = useState(10);
  const [visibleInvocations, setVisibleInvocations] = useState(10);

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
    setVisibleTransfers(10);
    setVisibleInvocations(10);

    try {
      // Fetch transfers and invocations in parallel
      const [transferList, invocationList] = await Promise.all([
        getRecentTransfers(address),
        getContractInvocations(address),
      ]);

      setTransfers(transferList);
      setInvocations(invocationList);

      // Extract unique contract IDs from transfers to get token metadata
      const contractIds = extractContractIds(transferList);

      // Build SAC metadata cache from transfer events with sacSymbol (4th topic)
      // These are standard Stellar assets with known symbol and decimals=7
      // Also persist to localStorage for reuse across pages and sessions
      const sacMetadataCache = {};
      for (const t of transferList) {
        if (t.sacSymbol && t.contractId) {
          sacMetadataCache[t.contractId] = { symbol: t.sacSymbol, name: t.sacName, decimals: 7 };
          // Cache to localStorage (only if not already cached)
          cacheSacMetadata(t.contractId, t.sacSymbol, t.sacName);
        }
      }

      if (contractIds.length > 0) {
        // Fetch metadata and balances for each token in parallel
        // For SAC tokens (with cached metadata), skip metadata fetch
        const tokenData = await Promise.all(
          contractIds.map(async (contractId) => {
            const cachedSac = sacMetadataCache[contractId];

            try {
              if (cachedSac) {
                // SAC token - we already have metadata, only fetch balance
                const rawBalance = await getTokenBalance(address, contractId);
                const displayBalance = rawToDisplay(rawBalance, 7);
                return {
                  contractId,
                  symbol: cachedSac.symbol,
                  name: cachedSac.name || cachedSac.symbol,
                  rawBalance,
                  balance: formatTokenBalance(displayBalance, 7),
                  decimals: 7,
                };
              }

              // Non-SAC token - fetch both metadata and balance
              const [metadata, rawBalance] = await Promise.all([
                getTokenMetadata(contractId),
                getTokenBalance(address, contractId),
              ]);
              const decimals = metadata.decimals ?? 7;
              const displayBalance = rawToDisplay(rawBalance, decimals);
              return {
                contractId,
                symbol: metadata.symbol === 'native' ? 'XLM' : metadata.symbol,
                name: metadata.name,
                rawBalance,
                balance: formatTokenBalance(displayBalance, decimals),
                decimals,
              };
            } catch (e) {
              console.log(`Token data unavailable for ${contractId}`);
              return {
                contractId,
                symbol: cachedSac?.symbol || '???',
                name: cachedSac?.name || cachedSac?.symbol || 'Unknown',
                rawBalance: '0',
                balance: '0',
                decimals: 7,
              };
            }
          })
        );

        // Build token info lookup map
        const infoMap = {};
        for (const token of tokenData) {
          infoMap[token.contractId] = { symbol: token.symbol, decimals: token.decimals };
        }
        setTokenInfo(infoMap);

        // Filter out tokens with zero balance and sort by symbol
        const displayBalances = tokenData
          .filter(t => t.rawBalance !== '0')
          .sort((a, b) => a.symbol.localeCompare(b.symbol));
        setBalances(displayBalances);
      } else {
        setBalances([]);
      }
    } catch (err) {
      console.error('Error loading data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatAmount = (amount, contractId) => {
    const info = tokenInfo[contractId];
    const decimals = info?.decimals ?? 7;
    const displayAmount = rawToDisplay(amount, decimals);
    return formatTokenBalance(displayAmount, decimals);
  };

  const getSymbol = (contractId) => {
    return tokenInfo[contractId]?.symbol || '???';
  };

  const renderTopicLink = (value) => {
    if (typeof value === 'string') {
      if (value.startsWith('G') || value.startsWith('C')) {
        return <Link href={`/account/${value}`}>{shortenAddressSmall(value)}</Link>;
      }
      if (value.startsWith('L')) {
        return <Link href={`/lp/${value}`}>{shortenAddressSmall(value)}</Link>;
      }
    }
    return formatTopicValue(value);
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
            ? 'Contract view requires a contract address (C...)'
            : `Invalid contract address: ${address}`}
        </p>
        <p>
          <Link href="/">back to search</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="scan-page page-contract">
      <ScanHeader />

      <AddressDisplay address={address} label="Contract" />

      <p style={{ marginTop: '8px' }}>
        <Link href={`/token/${address}`}>switch to token view →</Link>
      </p>

      {loading ? (
        <>
          <div className="section-title">Balances</div>
          <div className="balance-list">
            <SkeletonBalance count={2} />
          </div>
          <div className="section-title">Recent Activity</div>
          <SkeletonActivity count={3} />
          <div className="section-title">Recent Invocations</div>
          <SkeletonActivity count={3} />
        </>
      ) : error ? (
        <p className="error">error: {error}</p>
      ) : (
        <>
          <div className="section-title">Balances</div>

          {balances.length === 0 ? (
            <p>no token balances found</p>
          ) : (
            <div className="balance-list">
              {balances.map((b) => (
                <div key={b.contractId} className="balance-card">
                  <div className="balance-card-header">
                    <span className="balance-symbol">
                      <Link href={`/token/${b.contractId}`}>{b.symbol}</Link>
                    </span>
                  </div>
                  <div className="balance-amount">{b.balance}</div>
                </div>
              ))}
            </div>
          )}

          <div className="section-title">
            Recent Activity
            <a
              href="#"
              className="refresh-btn"
              onClick={(e) => { e.preventDefault(); setVisibleTransfers(10); loadData(); }}
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
                  {txGroups.slice(0, visibleTransfers).map((group) => (
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
                              ) : t.type === 'burn' || t.type === 'clawback' ? (
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
                                {formatAmount(t.amount, t.contractId)}{' '}
                                <Link href={`/token/${t.contractId}`}>{t.sacSymbol || getSymbol(t.contractId)}</Link>
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

                {visibleTransfers < txGroups.length && (
                  <p style={{ textAlign: 'center' }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); setVisibleTransfers(v => v + 10); }}>
                      show more
                    </a>
                  </p>
                )}
              </>
            );
          })()}

          <div className="section-title">
            Recent Invocations
            <a
              href="#"
              className="refresh-btn"
              onClick={(e) => { e.preventDefault(); setVisibleInvocations(10); loadData(); }}
            >
              refresh ↻
            </a>
          </div>

          {invocations.length === 0 ? (
            <p>no invocations found</p>
          ) : (
            <>
              <div className="card">
                {invocations.slice(0, visibleInvocations).map((inv, index) => (
                  <div key={`${inv.txHash}-${index}`} className="card-item">
                    <div className="activity-card-header">
                      <div className="event-type">
                        <span className={`event-dot ${inv.inSuccessfulContractCall ? '' : 'danger'}`} />
                        {inv.eventType}
                      </div>
                      <span className="activity-timestamp" title={new Date(inv.timestamp).toLocaleString()}>
                        {formatRelativeTime(inv.timestamp)}
                      </span>
                    </div>

                    {inv.topics.length > 0 && (
                      <div className="activity-addresses">
                        {inv.topics.map((topic, i) => (
                          <span key={i}>
                            {i > 0 && ', '}
                            {renderTopicLink(topic)}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="activity-footer">
                      {inv.value !== null && (
                        <span className="text-secondary">= {formatTopicValue(inv.value)}</span>
                      )}
                      <Link href={`/tx/${inv.txHash}`} className="activity-tx-link">
                        tx:{inv.txHash?.substring(0, 4)}
                      </Link>
                    </div>

                    {!inv.inSuccessfulContractCall && (
                      <span className="error" style={{ fontSize: '12px' }}>[failed]</span>
                    )}
                  </div>
                ))}
              </div>

              {visibleInvocations < invocations.length && (
                <p style={{ textAlign: 'center' }}>
                  <a href="#" onClick={(e) => { e.preventDefault(); setVisibleInvocations(v => v + 10); }}>
                    show more
                  </a>
                </p>
              )}
            </>
          )}
        </>
      )}

      <p style={{ marginTop: '24px' }}>
        <Link href="/">← new search</Link>
      </p>
    </div>
  );
}

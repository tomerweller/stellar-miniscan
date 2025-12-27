'use client'

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import * as StellarSdk from '@stellar/stellar-sdk';
import config from '@/utils/config';
import {
  isValidAddress,
  getTokenBalance,
  getTokenMetadata,
  getAccountActivity,
  extractContractIds,
  getTrackedAssets,
  addTrackedAsset,
  removeTrackedAsset,
  getCachedMetadata,
  cacheSacMetadata,
} from '@/utils/scan';
import { rawToDisplay, formatTokenBalance } from '@/utils/stellar/helpers';
import { formatRelativeTime } from '@/utils/scan/helpers';
import {
  ScanHeader,
  AddressDisplay,
  AddressLink,
  BalanceList,
  useNetwork,
  SkeletonActivity,
  SkeletonBalance,
} from '@/app/components';
import '@/app/scan.css';

export default function AccountPage({ params }) {
  const { address } = use(params);
  const { network, isLoading: networkLoading } = useNetwork();
  const [balances, setBalances] = useState([]);
  const [activity, setActivity] = useState([]); // Unified transfers + fees
  const [activityError, setActivityError] = useState(null); // Error message for activity section
  const [tokenInfo, setTokenInfo] = useState({}); // { contractId: { symbol, decimals } }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [newAssetAddress, setNewAssetAddress] = useState('');
  const [addingAsset, setAddingAsset] = useState(false);
  const [addAssetError, setAddAssetError] = useState('');
  const [visibleCount, setVisibleCount] = useState(10);

  const isValid = isValidAddress(address);

  useEffect(() => {
    if (isValid && !networkLoading) {
      loadData();
    }
  }, [address, isValid, network, networkLoading]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    setActivityError(null);
    setVisibleCount(10);

    try {
      // Get the XLM contract ID - always show XLM balance regardless of activity
      const xlmContractId = StellarSdk.Asset.native().contractId(config.networkPassphrase);

      // Fetch XLM balance and activity in parallel
      // Activity fetch may fail for new/inactive accounts - that's ok
      let activityList = [];
      let activityErr = null;
      let xlmBalance = '0';

      const [activityResult, xlmBalanceResult] = await Promise.allSettled([
        getAccountActivity(address),
        getTokenBalance(address, xlmContractId),
      ]);

      // Handle activity result
      if (activityResult.status === 'fulfilled') {
        activityList = activityResult.value;
      } else {
        const e = activityResult.reason;
        if (e.code === -32001 || e.message?.includes('-32001')) {
          activityErr = 'too much data';
        } else {
          console.log('No activity found for account:', e.message);
        }
      }
      setActivity(activityList);
      setActivityError(activityErr);

      // Handle XLM balance result
      if (xlmBalanceResult.status === 'fulfilled') {
        xlmBalance = xlmBalanceResult.value;
      }

      // Step 2: Extract unique contract IDs from transfers + manually tracked assets
      // Filter to only include transfer events (not fee events)
      const transfers = activityList.filter(a => a.type !== 'fee');
      const autoContractIds = extractContractIds(transfers);
      const manualAssets = getTrackedAssets();
      const manualContractIds = manualAssets.map(a => a.contractId);

      // Build SAC metadata cache from transfer events with sacSymbol (4th topic)
      // These are standard Stellar assets with known symbol and decimals=7
      // Also persist to localStorage for reuse across pages and sessions
      const sacMetadataCache = {};
      for (const t of transfers) {
        if (t.sacSymbol && t.contractId) {
          sacMetadataCache[t.contractId] = { symbol: t.sacSymbol, name: t.sacName, decimals: 7 };
          // Cache to localStorage (only if not already cached)
          cacheSacMetadata(t.contractId, t.sacSymbol, t.sacName);
        }
      }

      // Merge and dedupe contract IDs (exclude XLM - we handle it separately)
      const otherContractIds = [...new Set([...autoContractIds, ...manualContractIds])]
        .filter(id => id !== xlmContractId);

      // Always include XLM balance
      const xlmDisplayBalance = rawToDisplay(xlmBalance, 7);
      const xlmBalanceObj = {
        contractId: xlmContractId,
        symbol: 'XLM',
        name: 'native',
        rawBalance: xlmBalance,
        balance: formatTokenBalance(xlmDisplayBalance, 7),
        decimals: 7,
        isManual: false,
      };

      if (otherContractIds.length === 0) {
        // Only XLM balance
        setBalances([xlmBalanceObj]);
        setTokenInfo({ [xlmContractId]: { symbol: 'XLM', decimals: 7 } });
        setLoading(false);
        return;
      }

      // Step 3: Fetch metadata and balances for other tokens in parallel
      // For SAC tokens (with cached metadata), skip metadata fetch
      const tokenData = await Promise.all(
        otherContractIds.map(async (contractId) => {
          const isManual = manualContractIds.includes(contractId);
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
                isManual,
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
              isManual,
            };
          } catch (e) {
            // Token metadata/balance fetch can fail for non-token contracts - that's ok
            console.log(`Token data unavailable for ${contractId}`);
            return {
              contractId,
              symbol: cachedSac?.symbol || '???',
              name: cachedSac?.name || cachedSac?.symbol || 'Unknown',
              rawBalance: '0',
              balance: '0',
              decimals: 7,
              isManual,
            };
          }
        })
      );

      // Build token info lookup map (symbol + decimals) - include XLM
      const infoMap = { [xlmContractId]: { symbol: 'XLM', decimals: 7 } };
      for (const token of tokenData) {
        infoMap[token.contractId] = { symbol: token.symbol, decimals: token.decimals };
      }
      setTokenInfo(infoMap);

      // Filter out tokens with zero balance (unless manually tracked) and sort by symbol
      // Always include XLM at the start
      const otherBalances = tokenData
        .filter(t => t.rawBalance !== '0' || t.isManual)
        .sort((a, b) => a.symbol.localeCompare(b.symbol));
      setBalances([xlmBalanceObj, ...otherBalances]);
    } catch (err) {
      console.error('Error loading data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Format activity item for display - handles both transfers and fees
  const formatActivity = (item) => {
    if (item.type === 'fee') {
      // Fee event - XLM with 7 decimals
      const displayAmount = rawToDisplay(item.amount, 7);
      return {
        ...item,
        formattedAmount: formatTokenBalance(displayAmount, 7),
        symbol: 'XLM',
      };
    } else {
      // Transfer event
      const info = tokenInfo[item.contractId];
      const decimals = info?.decimals ?? 7;
      const displayAmount = rawToDisplay(item.amount, decimals);
      return {
        ...item,
        formattedAmount: formatTokenBalance(displayAmount, decimals),
        // Use sacSymbol from event topic if available (SAC transfers), otherwise fall back to tokenInfo
        symbol: item.sacSymbol || info?.symbol || '???',
      };
    }
  };

  const handleAddAsset = async (e) => {
    e.preventDefault();
    setAddAssetError('');
    setAddingAsset(true);

    const contractId = newAssetAddress.trim();

    if (!contractId.startsWith('C') || !isValidAddress(contractId)) {
      setAddAssetError('Invalid contract address. Must be a C... address');
      setAddingAsset(false);
      return;
    }

    // Check if already in balances
    if (balances.find(b => b.contractId === contractId)) {
      setAddAssetError('Asset already tracked');
      setAddingAsset(false);
      return;
    }

    try {
      const [metadata, rawBalance] = await Promise.all([
        getTokenMetadata(contractId),
        getTokenBalance(address, contractId),
      ]);

      const decimals = metadata.decimals ?? 7;
      const displayBalance = rawToDisplay(rawBalance, decimals);

      // Add to localStorage
      addTrackedAsset(contractId, metadata.symbol, metadata.name);

      // Update balances state
      const newBalance = {
        contractId,
        symbol: metadata.symbol === 'native' ? 'XLM' : metadata.symbol,
        name: metadata.name,
        rawBalance,
        balance: formatTokenBalance(displayBalance, decimals),
        decimals,
        isManual: true,
      };
      setBalances(prev => [...prev, newBalance].sort((a, b) => a.symbol.localeCompare(b.symbol)));
      setTokenInfo(prev => ({ ...prev, [contractId]: { symbol: newBalance.symbol, decimals } }));

      setNewAssetAddress('');
      setShowAddAsset(false);
    } catch (error) {
      console.error('Error adding asset:', error);
      setAddAssetError(`Failed to add asset: ${error.message}`);
    } finally {
      setAddingAsset(false);
    }
  };

  const handleRemoveAsset = (contractId) => {
    removeTrackedAsset(contractId);
    setBalances(prev => prev.filter(b => b.contractId !== contractId));
  };

  // Get direction for transfer relative to current account
  const getDirection = (item) => {
    if (item.type === 'fee') {
      return item.isRefund ? 'in' : 'out';
    }
    if (item.type === 'mint') {
      return item.to === address ? 'in' : null;
    }
    if (item.type === 'burn' || item.type === 'clawback') {
      return item.from === address ? 'out' : null;
    }
    // transfer
    if (item.from === address) return 'out';
    if (item.to === address) return 'in';
    return null;
  };

  // Get event type display info
  const getEventTypeInfo = (item) => {
    const direction = getDirection(item);
    switch (item.type) {
      case 'fee':
        return { label: item.isRefund ? 'Refund' : 'Fee', dotClass: item.isRefund ? 'success' : '' };
      case 'mint': return { label: 'Mint', dotClass: 'success' };
      case 'burn': return { label: 'Burn', dotClass: 'danger' };
      case 'clawback': return { label: 'Clawback', dotClass: 'danger' };
      default:
        return direction === 'in'
          ? { label: 'Received', dotClass: 'success' }
          : { label: 'Sent', dotClass: '' };
    }
  };

  if (!isValid) {
    return (
      <div className="scan-page">
        <ScanHeader />
        <p className="error">Invalid address: {address}</p>
        <p>
          <Link href="/">back to search</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="scan-page page-account">
      <ScanHeader />

      <AddressDisplay address={address} label="Account" />

      {address.startsWith('C') && (
        <p style={{ marginTop: '8px' }}>
          <Link href={`/token/${address}`}>switch to token view →</Link>
        </p>
      )}

      {loading ? (
        <>
          <div className="section-title">Balances</div>
          <div className="balance-list">
            <SkeletonBalance count={3} />
          </div>
          <div className="section-title">Token Activity</div>
          <SkeletonActivity count={5} />
        </>
      ) : error ? (
        <p className="error">error: {error}</p>
      ) : (
        <>
          <div className="section-title">Balances</div>

          <BalanceList
            balances={balances}
            onRemove={handleRemoveAsset}
          />

          <p style={{ marginTop: '12px' }}>
            <a href="#" onClick={(e) => { e.preventDefault(); setShowAddAsset(true); }}>+ add asset</a>
          </p>

          {showAddAsset && (
            <div className="modal-overlay" onClick={() => !addingAsset && setShowAddAsset(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>add asset</h3>

                <form onSubmit={handleAddAsset}>
                  <div className="form-group">
                    <label htmlFor="assetAddress">token contract address</label>
                    <input
                      type="text"
                      id="assetAddress"
                      value={newAssetAddress}
                      onChange={(e) => setNewAssetAddress(e.target.value)}
                      placeholder="C..."
                      disabled={addingAsset}
                      autoComplete="off"
                      spellCheck="false"
                    />
                  </div>

                  {addAssetError && <p className="error">{addAssetError}</p>}

                  <p>
                    <a href="#" onClick={(e) => { e.preventDefault(); setShowAddAsset(false); setAddAssetError(''); setNewAssetAddress(''); }}>cancel</a>
                    {' | '}
                    <a href="#" onClick={handleAddAsset}>
                      {addingAsset ? 'adding...' : 'add'}
                    </a>
                  </p>
                </form>
              </div>
            </div>
          )}

          <div className="section-title">
            Token Activity
            <a
              href="#"
              className="refresh-btn"
              onClick={(e) => { e.preventDefault(); setVisibleCount(10); loadData(); }}
            >
              refresh ↻
            </a>
          </div>

          {activityError ? (
            <p className="error">{activityError}</p>
          ) : activity.length === 0 ? (
            <p>no token activity found</p>
          ) : (() => {
            // Group events by transaction hash
            const txGroups = [];
            const txMap = new Map();
            for (const item of activity) {
              if (!txMap.has(item.txHash)) {
                const group = { txHash: item.txHash, timestamp: item.timestamp, events: [] };
                txMap.set(item.txHash, group);
                txGroups.push(group);
              }
              txMap.get(item.txHash).events.push(item);
            }

            return (
              <>
                <div className="card">
                  {txGroups.slice(0, visibleCount).map((group) => (
                    <div key={group.txHash} className="card-item">
                      {group.events.map((item, eventIndex) => {
                        const formatted = formatActivity(item);
                        const typeInfo = getEventTypeInfo(item);
                        const direction = getDirection(item);

                        return (
                          <div key={eventIndex} style={{ marginBottom: eventIndex < group.events.length - 1 ? '12px' : '0' }}>
                            <div className="activity-card-header">
                              <div className="event-type">
                                <span className={`event-dot ${typeInfo.dotClass}`} />
                                {typeInfo.label}
                                {direction && (
                                  <span className={`direction-badge ${direction}`}>
                                    {direction === 'in' ? '↓' : '↑'}
                                  </span>
                                )}
                              </div>
                              {eventIndex === 0 && (
                                <span className="activity-timestamp" title={new Date(group.timestamp).toLocaleString()}>
                                  {formatRelativeTime(group.timestamp)}
                                </span>
                              )}
                            </div>

                            <div className="activity-addresses">
                              {item.type === 'fee' ? (
                                <span className="text-secondary">transaction fee</span>
                              ) : item.type === 'mint' ? (
                                <>→ <AddressLink address={item.to} /></>
                              ) : item.type === 'burn' ? (
                                <AddressLink address={item.from} />
                              ) : item.type === 'clawback' ? (
                                <>
                                  <AddressLink address={item.from} />
                                  <span className="text-secondary"> (by <AddressLink address={item.to} />)</span>
                                </>
                              ) : (
                                <>
                                  <AddressLink address={item.from} />
                                  {' → '}
                                  <AddressLink address={item.to} />
                                </>
                              )}
                            </div>

                            <div className="activity-footer">
                              <span className={`activity-amount ${
                                item.type === 'mint' || (item.type === 'fee' && item.isRefund) ? 'positive' :
                                item.type === 'clawback' || item.type === 'burn' || (item.type === 'fee' && !item.isRefund) ? 'negative' :
                                direction === 'in' ? 'positive' : direction === 'out' ? 'negative' : ''
                              }`}>
                                {(item.type === 'mint' || (item.type === 'fee' && item.isRefund) || direction === 'in') && '+'}
                                {(item.type === 'burn' || item.type === 'clawback' || (item.type === 'fee' && !item.isRefund) || direction === 'out') && '-'}
                                {formatted.formattedAmount}{' '}
                                {item.type === 'fee' ? (
                                  <span>XLM</span>
                                ) : (
                                  <Link href={`/token/${item.contractId}`}>{formatted.symbol}</Link>
                                )}
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

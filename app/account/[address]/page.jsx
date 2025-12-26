'use client'

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  isValidAddress,
  getTokenBalance,
  getTokenMetadata,
  getAccountActivity,
  extractContractIds,
  getTrackedAssets,
  addTrackedAsset,
  removeTrackedAsset,
} from '@/utils/scan';
import { rawToDisplay, formatTokenBalance } from '@/utils/stellar/helpers';
import { formatTimestamp } from '@/utils/scan/helpers';
import {
  ScanHeader,
  AddressDisplay,
  BalanceList,
  useNetwork,
} from '@/app/components';
import '@/app/scan.css';

export default function AccountPage({ params }) {
  const { address } = use(params);
  const { network, isLoading: networkLoading } = useNetwork();
  const [balances, setBalances] = useState([]);
  const [activity, setActivity] = useState([]); // Unified transfers + fees
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
    setVisibleCount(10);

    try {
      // Step 1: Fetch unified activity (transfers + fees in single query)
      const activityList = await getAccountActivity(address);
      setActivity(activityList);

      // Step 2: Extract unique contract IDs from transfers + manually tracked assets
      // Filter to only include transfer events (not fee events)
      const transfers = activityList.filter(a => a.type !== 'fee');
      const autoContractIds = extractContractIds(transfers);
      const manualAssets = getTrackedAssets();
      const manualContractIds = manualAssets.map(a => a.contractId);

      // Merge and dedupe contract IDs
      const allContractIds = [...new Set([...autoContractIds, ...manualContractIds])];

      if (allContractIds.length === 0) {
        setBalances([]);
        setLoading(false);
        return;
      }

      // Step 3: Fetch metadata and balances for each token in parallel
      const tokenData = await Promise.all(
        allContractIds.map(async (contractId) => {
          const isManual = manualContractIds.includes(contractId);
          try {
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
            console.error(`Error fetching token data for ${contractId}:`, e);
            return {
              contractId,
              symbol: '???',
              name: 'Unknown',
              rawBalance: '0',
              balance: '0',
              decimals: 7,
              isManual,
            };
          }
        })
      );

      // Build token info lookup map (symbol + decimals)
      const infoMap = {};
      for (const token of tokenData) {
        infoMap[token.contractId] = { symbol: token.symbol, decimals: token.decimals };
      }
      setTokenInfo(infoMap);

      // Filter out tokens with zero balance (unless manually tracked) and sort by symbol
      const displayBalances = tokenData
        .filter(t => t.rawBalance !== '0' || t.isManual)
        .sort((a, b) => a.symbol.localeCompare(b.symbol));
      setBalances(displayBalances);
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
        symbol: info?.symbol || '???',
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

  if (!isValid) {
    return (
      <div className="scan-page">
        <ScanHeader />
        <hr />
        <p className="error">Invalid address: {address}</p>
        <p>
          <Link href="/">back to search</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="scan-page">
      <ScanHeader />
      <hr />

      <AddressDisplay address={address} />

      {address.startsWith('C') && (
        <p>
          <Link href={`/token/${address}`}>switch to token view</Link>
        </p>
      )}

      <hr />

      {loading ? (
        <p>loading...</p>
      ) : error ? (
        <p className="error">error: {error}</p>
      ) : (
        <>
          <h2>balances</h2>

          <BalanceList
            balances={balances}
            onRemove={handleRemoveAsset}
          />

          <p>
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

          <hr />

          <h2>activity</h2>

          {activity.length === 0 ? (
            <p>no activity found</p>
          ) : (
            <>
              <div className="transfer-list">
                {activity.slice(0, visibleCount).map((item, index) => {
                  const formatted = formatActivity(item);
                  return (
                    <p key={`${item.txHash}-${index}`} className="transfer-item">
                      {item.type === 'fee' ? (
                        // Fee event display
                        <>
                          <span className={formatted.isRefund ? 'success' : ''}>
                            {formatted.isRefund ? '+' : '-'}{formatted.formattedAmount} XLM
                          </span>
                          {' '}
                          <span style={{ color: 'var(--text-secondary)' }}>
                            ({formatted.isRefund ? 'refund' : 'fee'})
                          </span>
                        </>
                      ) : (
                        // Transfer event display
                        <>
                          {item.direction === 'sent' ? 'sent ' : 'received '}
                          {formatted.formattedAmount}{' '}
                          <Link href={`/token/${item.contractId}`}>{formatted.symbol}</Link>
                          {' '}
                          {item.direction === 'sent' ? 'to ' : 'from '}
                          <Link href={`/account/${item.counterparty}`}>
                            {item.counterparty?.substring(0, 4)}..{item.counterparty?.slice(-4)}
                          </Link>
                        </>
                      )}
                      <br />
                      <small>
                        {formatTimestamp(formatted.timestamp)}
                        {' '}
                        (<Link href={`/tx/${formatted.txHash}`}>{formatted.txHash?.substring(0, 4)}</Link>)
                      </small>
                    </p>
                  );
                })}
              </div>

              {visibleCount < activity.length && (
                <p>
                  <a href="#" onClick={(e) => { e.preventDefault(); setVisibleCount(v => v + 10); }}>
                    show more
                  </a>
                  {' | '}
                  <a href="#" onClick={(e) => { e.preventDefault(); loadData(); }}>
                    refresh
                  </a>
                </p>
              )}

              {visibleCount >= activity.length && (
                <p>
                  <a href="#" onClick={(e) => { e.preventDefault(); loadData(); }}>
                    refresh
                  </a>
                </p>
              )}
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

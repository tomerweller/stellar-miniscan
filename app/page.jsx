'use client'

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as StellarSdk from '@stellar/stellar-sdk';
import {
  isValidAddress,
  getRecentTokenActivity,
  getTokenMetadata,
  getPoolShareMetadata,
  extractContractIds,
} from '@/utils/scan';
import { rawToDisplay, formatTokenBalance } from '@/utils/stellar/helpers';
import { ScanHeader, AddressLink, useNetwork, SkeletonActivity } from './components';
import { formatRelativeTime } from '@/utils/scan/helpers';
import { getNetworkConfig } from '@/utils/config';
import './scan.css';

export default function ScanPage() {
  const router = useRouter();
  const { network, isLoading: networkLoading } = useNetwork();
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [activity, setActivity] = useState([]);
  const [tokenInfo, setTokenInfo] = useState({});
  const [loading, setLoading] = useState(true);
  const [activityError, setActivityError] = useState(null);
  const [visibleCount, setVisibleCount] = useState(10);

  useEffect(() => {
    if (!networkLoading) {
      loadRecentActivity();
    }
  }, [network, networkLoading]);

  const resetVisibleCount = () => setVisibleCount(10);

  const loadRecentActivity = async () => {
    setLoading(true);
    setActivityError(null);

    try {
      const transfers = await getRecentTokenActivity(200);
      setActivity(transfers);

      // Extract unique contract IDs and fetch metadata
      const contractIds = extractContractIds(transfers);
      const infoMap = {};

      await Promise.all(
        contractIds.map(async (contractId) => {
          try {
            const metadata = await getTokenMetadata(contractId);
            infoMap[contractId] = {
              symbol: metadata.symbol === 'native' ? 'XLM' : metadata.symbol,
              decimals: metadata.decimals ?? 7,
            };
          } catch {
            // Try to detect pool share tokens
            const poolMeta = await getPoolShareMetadata(contractId);
            if (poolMeta) {
              infoMap[contractId] = {
                symbol: poolMeta.symbol,
                decimals: poolMeta.decimals,
                isPoolShare: true,
              };
            } else {
              infoMap[contractId] = { symbol: '???', decimals: 7 };
            }
          }
        })
      );

      setTokenInfo(infoMap);
    } catch (err) {
      console.error('Error loading recent activity:', err);
      setActivityError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Format transfer for display
  const formatTransfer = (item) => {
    const info = tokenInfo[item.contractId];
    const decimals = info?.decimals ?? 7;
    const displayAmount = rawToDisplay(item.amount, decimals);
    return {
      ...item,
      formattedAmount: formatTokenBalance(displayAmount, decimals),
      // Use sacSymbol from event topic if available (SAC transfers), otherwise fall back to tokenInfo
      symbol: item.sacSymbol || info?.symbol || '???',
    };
  };

  // Check if input looks like a transaction hash (64 hex characters)
  const isValidTxHash = (input) => {
    return /^[a-fA-F0-9]{64}$/.test(input);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    const trimmedInput = address.trim();
    if (!trimmedInput) {
      setError('Please enter an address or transaction hash');
      return;
    }

    // Check if input is a transaction hash
    if (isValidTxHash(trimmedInput)) {
      router.push(`/tx/${trimmedInput.toLowerCase()}`);
      return;
    }

    // Check if input is in asset:issuer format (e.g., USDC:GA5ZSE...)
    if (trimmedInput.includes(':')) {
      const [assetCode, issuer] = trimmedInput.split(':');

      if (!assetCode || !issuer) {
        setError('Invalid format. Use ASSET:ISSUER (e.g., USDC:GA5ZSE...)');
        return;
      }

      if (!isValidAddress(issuer) || !issuer.startsWith('G')) {
        setError('Invalid issuer address. Must be a G... address');
        return;
      }

      try {
        // Compute SAC contract address
        const asset = new StellarSdk.Asset(assetCode, issuer);
        const networkConfig = getNetworkConfig(network);
        const contractId = asset.contractId(networkConfig.passphrase);
        router.push(`/token/${contractId}`);
        return;
      } catch (err) {
        setError(`Invalid asset: ${err.message}`);
        return;
      }
    }

    // Regular address handling
    if (!isValidAddress(trimmedInput)) {
      setError('Invalid input. Enter a G/C/L address, tx hash, or ASSET:ISSUER');
      return;
    }

    // Route based on address type
    if (trimmedInput.startsWith('C')) {
      router.push(`/contract/${trimmedInput}`);
    } else if (trimmedInput.startsWith('L')) {
      router.push(`/lp/${trimmedInput}`);
    } else {
      router.push(`/account/${trimmedInput}`);
    }
  };

  // Get event type display info
  const getEventTypeInfo = (type, isRefund) => {
    switch (type) {
      case 'mint': return { label: 'Mint', dotClass: 'success' };
      case 'burn': return { label: 'Burn', dotClass: 'danger' };
      case 'clawback': return { label: 'Clawback', dotClass: 'danger' };
      case 'fee': return { label: isRefund ? 'Fee Refund' : 'Fee', dotClass: isRefund ? 'success' : '' };
      default: return { label: 'Transfer', dotClass: '' };
    }
  };

  // Group transfers by transaction hash
  const groupByTransaction = (items) => {
    const txGroups = [];
    const txMap = new Map();
    for (const item of items) {
      if (!txMap.has(item.txHash)) {
        const group = { txHash: item.txHash, timestamp: item.timestamp, events: [] };
        txMap.set(item.txHash, group);
        txGroups.push(group);
      }
      txMap.get(item.txHash).events.push(item);
    }
    return txGroups;
  };

  return (
    <div className="scan-page">
      <ScanHeader />

      <form onSubmit={handleSubmit}>
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            id="searchInput"
            name="search"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Search address, tx hash, or ASSET:ISSUER..."
            autoComplete="off"
            spellCheck="false"
          />
        </div>

        {error && <p className="error">{error}</p>}
      </form>

      <div className="section-title">
        Recent Token Activity
        <a
          href="#"
          className="refresh-btn"
          onClick={(e) => { e.preventDefault(); resetVisibleCount(); loadRecentActivity(); }}
        >
          refresh ↻
        </a>
      </div>

      {loading ? (
        <SkeletonActivity count={5} />
      ) : activityError ? (
        <p className="error">Error: {activityError}</p>
      ) : activity.length === 0 ? (
        <p>No recent activity</p>
      ) : (() => {
        const txGroups = groupByTransaction(activity);

        return (
          <>
            <div className="card">
              {txGroups.slice(0, visibleCount).map((group) => (
                <Link href={`/tx/${group.txHash}`} key={group.txHash} className="card-item">
                  {group.events.map((item, eventIndex) => {
                    const formatted = formatTransfer(item);
                    const typeInfo = getEventTypeInfo(item.type, item.isRefund);

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
                          {item.type === 'mint' ? (
                            <>→ <AddressLink address={item.to} nested /></>
                          ) : item.type === 'burn' || item.type === 'fee' ? (
                            <AddressLink address={item.from} nested />
                          ) : (
                            <>
                              <AddressLink address={item.from} nested />
                              {' → '}
                              <AddressLink address={item.to} nested />
                            </>
                          )}
                        </div>

                        <div className="activity-footer">
                          <span className={`activity-amount ${
                            item.type === 'mint' || item.isRefund ? 'positive' :
                            item.type === 'clawback' || (item.type === 'fee' && !item.isRefund) ? 'negative' : ''
                          }`}>
                            {(item.type === 'mint' || item.isRefund) && '+'}
                            {(item.type === 'burn' || item.type === 'clawback' || (item.type === 'fee' && !item.isRefund)) && '-'}
                            {formatted.formattedAmount}{' '}
                            <span
                              className="nested-link"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/token/${item.contractId}`); }}
                            >{formatted.symbol}</span>
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
    </div>
  );
}

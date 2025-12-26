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
import { ScanHeader, AddressLink, useNetwork } from './components';
import { formatTimestamp } from '@/utils/scan/helpers';
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
      symbol: info?.symbol || '???',
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

  return (
    <div className="scan-page">
      <ScanHeader />

      <hr />

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="address">enter address</label>
          <input
            type="text"
            id="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="G... / C... / L... / tx hash / ASSET:ISSUER"
            autoComplete="off"
            spellCheck="false"
          />
        </div>

        {error && <p className="error">{error}</p>}

        <p>
          <a href="#" onClick={handleSubmit}>explore</a>
        </p>
      </form>

      <hr />

      <h2>recent activity</h2>

      {loading ? (
        <p>loading...</p>
      ) : activityError ? (
        <p className="error">error: {activityError}</p>
      ) : activity.length === 0 ? (
        <p>no recent activity</p>
      ) : (() => {
        // Group transfers by transaction hash
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
            <div className="transfer-list">
              {txGroups.slice(0, visibleCount).map((group) => (
                <div key={group.txHash} className="tx-group">
                  {group.events.map((item, eventIndex) => {
                    const formatted = formatTransfer(item);
                    return (
                      <p key={eventIndex} className="transfer-item">
                        <AddressLink address={item.from} />
                        {' → '}
                        <AddressLink address={item.to} />
                        {': '}
                        {formatted.formattedAmount}{' '}
                        <Link href={`/token/${item.contractId}`}>{formatted.symbol}</Link>
                      </p>
                    );
                  })}
                  <small>
                    {formatTimestamp(group.timestamp)}
                    {' '}
                    (<Link href={`/tx/${group.txHash}`}>{group.txHash?.substring(0, 4)}</Link>)
                  </small>
                </div>
              ))}
            </div>

            <p>
              {visibleCount < txGroups.length && (
                <>
                  <a href="#" onClick={(e) => { e.preventDefault(); setVisibleCount(v => v + 10); }}>show more</a>
                  {' | '}
                </>
              )}
              <a href="#" onClick={(e) => { e.preventDefault(); resetVisibleCount(); loadRecentActivity(); }}>refresh</a>
            </p>
          </>
        );
      })()}
    </div>
  );
}

'use client'

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
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
} from '@/app/components';
import { formatTimestamp } from '@/utils/scan/helpers';
import '@/app/scan.css';

export default function LiquidityPoolPage({ params }) {
  const { address } = use(params);
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

  if (!isValid) {
    return (
      <div className="scan-page">
        <ScanHeader />
        <hr />
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
      <hr />

      <AddressDisplay address={address} label="lp:" />

      <hr />

      {loading ? (
        <p>loading...</p>
      ) : error ? (
        <p className="error">error: {error}</p>
      ) : (
        <>
          <h2>pool info</h2>

          <p><strong>type:</strong> constant product (AMM)</p>
          <p><strong>fee:</strong> {formatFee(poolData.fee)}</p>
          <p><strong>total pool shares:</strong> {formatPoolShares(poolData.totalPoolShares)}</p>
          <p><strong>trustline count:</strong> {poolData.trustlineCount}</p>

          <hr />

          <h2>reserves</h2>

          <p className="balance-row">
            <span className="balance-amount">
              {formatReserve(poolData.assetA.reserve)}{' '}
              <Link href={`/token/${poolData.assetA.contractId}`}>
                {poolData.assetA.code}
              </Link>
            </span>
          </p>

          <p className="balance-row">
            <span className="balance-amount">
              {formatReserve(poolData.assetB.reserve)}{' '}
              <Link href={`/token/${poolData.assetB.contractId}`}>
                {poolData.assetB.code}
              </Link>
            </span>
          </p>

          <hr />

          <h2>recent activity</h2>

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
                <div className="transfer-list">
                  {txGroups.slice(0, visibleCount).map((group) => (
                    <div key={group.txHash} className="tx-group">
                      {group.events.map((t, eventIndex) => {
                        const ft = formatTransfer(t);
                        return (
                          <p key={eventIndex} className="transfer-item">
                            <AddressLink address={t.from} />
                            {' → '}
                            <AddressLink address={t.to} />
                            {': '}
                            {ft.formattedAmount}{' '}
                            <Link href={`/token/${t.contractId}`}>{ft.symbol}</Link>
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
                  <a href="#" onClick={(e) => { e.preventDefault(); loadData(); }}>refresh</a>
                </p>
              </>
            );
          })()}
        </>
      )}

      <hr />

      <p>
        <Link href="/">new search</Link>
      </p>
    </div>
  );
}

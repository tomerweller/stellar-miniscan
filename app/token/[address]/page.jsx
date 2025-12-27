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
} from '@/app/components';
import { formatTimestamp } from '@/utils/scan/helpers';
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

  if (!isValid) {
    return (
      <div className="scan-page">
        <ScanHeader />
        <hr />
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
      <hr />

      <AddressDisplay address={address} label="token:" />

      <p>
        <Link href={`/contract/${address}`}>switch to contract view</Link>
      </p>

      <hr />

      {loading ? (
        <p>loading...</p>
      ) : error ? (
        <p className="error">
          {error.includes('not found') ? 'token contract not found' : `error: ${error}`}
        </p>
      ) : (
        <>
          <h2>token info</h2>

          <p><strong>symbol:</strong> {getSymbol()}</p>
          <p><strong>name:</strong> {metadata?.name || 'Unknown'}</p>
          <p><strong>decimals:</strong> {metadata?.decimals ?? 7}</p>

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
                      {group.events.map((t, eventIndex) => (
                        <p key={eventIndex} className="transfer-item">
                          <AddressLink address={t.from} />
                          {' → '}
                          <AddressLink address={t.to} />
                          {': '}
                          {formatAmount(t.amount)} {getSymbol()}
                        </p>
                      ))}
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

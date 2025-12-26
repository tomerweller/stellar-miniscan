'use client'

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  isValidAddress,
  getTokenMetadata,
  getTokenTransfers,
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
      const [tokenMetadata, tokenTransfers] = await Promise.all([
        getTokenMetadata(address),
        getTokenTransfers(address),
      ]);

      setMetadata(tokenMetadata);
      setTransfers(tokenTransfers);
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
    <div className="scan-page">
      <ScanHeader />
      <hr />

      <AddressDisplay address={address} />

      <p>
        <Link href={`/contract/${address}`}>switch to contract view</Link>
      </p>

      <hr />

      {loading ? (
        <p>loading...</p>
      ) : error ? (
        <p className="error">error: {error}</p>
      ) : (
        <>
          <h2>token info</h2>

          <p><strong>symbol:</strong> {getSymbol()}</p>
          <p><strong>name:</strong> {metadata?.name || 'Unknown'}</p>
          <p><strong>decimals:</strong> {metadata?.decimals ?? 7}</p>

          <hr />

          <h2>recent transfers</h2>

          {transfers.length === 0 ? (
            <p>no transfers found</p>
          ) : (
            <>
              <div className="transfer-list">
                {transfers.slice(0, visibleCount).map((t, index) => (
                  <p key={`${t.txHash}-${index}`} className="transfer-item">
                    <AddressLink address={t.from} />
                    {' -> '}
                    <AddressLink address={t.to} />
                    {': '}
                    {formatAmount(t.amount)} {getSymbol()}
                    <br />
                    <small>{formatTimestamp(t.timestamp)} (<Link href={`/tx/${t.txHash}`}>{t.txHash?.substring(0, 4)}</Link>)</small>
                  </p>
                ))}
              </div>

              <p>
                {visibleCount < transfers.length && (
                  <>
                    <a href="#" onClick={(e) => { e.preventDefault(); setVisibleCount(v => v + 10); }}>show more</a>
                    {' | '}
                  </>
                )}
                <a href="#" onClick={(e) => { e.preventDefault(); loadData(); }}>refresh</a>
              </p>
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

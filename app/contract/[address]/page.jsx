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
} from '@/utils/scan';
import { rawToDisplay, formatTokenBalance } from '@/utils/stellar/helpers';
import { getStellarExpertUrl } from '@/utils/scan/helpers';
import { useNetwork, ScanHeader, AddressDisplay, AddressLink } from '@/app/components';
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
  const [copied, setCopied] = useState(false);
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

      if (contractIds.length > 0) {
        // Fetch metadata and balances for each token in parallel
        const tokenData = await Promise.all(
          contractIds.map(async (contractId) => {
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

  const copyToClipboard = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shortenAddress = (addr) => {
    if (!addr || addr.length < 12) return addr;
    return `${addr.substring(0, 6)}....${addr.substring(addr.length - 6)}`;
  };

  const shortenAddressSmall = (addr) => {
    if (!addr || addr.length < 12) return addr;
    return `${addr.substring(0, 4)}..${addr.substring(addr.length - 4)}`;
  };

  const formatAmount = (amount, contractId) => {
    const info = tokenInfo[contractId];
    const decimals = info?.decimals ?? 7;
    const displayAmount = rawToDisplay(amount, decimals);
    return formatTokenBalance(displayAmount, decimals);
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString();
  };

  const getSymbol = (contractId) => {
    return tokenInfo[contractId]?.symbol || '???';
  };

  const formatTopicValue = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
      // If it looks like an address, shorten it
      if (value.startsWith('G') || value.startsWith('C')) {
        return shortenAddressSmall(value);
      }
      return value;
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (typeof value === 'object') {
      // Use replacer to handle BigInt inside objects
      return JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
    }
    return String(value);
  };

  const renderTopicLink = (value) => {
    if (typeof value === 'string' && (value.startsWith('G') || value.startsWith('C'))) {
      return <Link href={`/account/${value}`}>{shortenAddressSmall(value)}</Link>;
    }
    return formatTopicValue(value);
  };

  if (!isValid) {
    return (
      <div className="scan-page">
        <ScanHeader />

        <hr />

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
    <div className="scan-page">
      <ScanHeader />

      <hr />

      <p>
        <strong>contract:</strong>{' '}
        {shortenAddress(address)}{' '}
        (<a href="#" onClick={(e) => { e.preventDefault(); copyToClipboard(); }}>
          {copied ? 'copied!' : 'copy'}
        </a>)
        {' | '}
        <a href={getStellarExpertUrl(address, network)} target="_blank" rel="noopener noreferrer">
          stellar.expert
        </a>
      </p>

      <p>
        <Link href={`/token/${address}`}>token view</Link>
      </p>

      <hr />

      {loading ? (
        <p>loading...</p>
      ) : error ? (
        <p className="error">error: {error}</p>
      ) : (
        <>
          <h2>balances</h2>

          {balances.length === 0 ? (
            <p>no token balances found</p>
          ) : (
            balances.map((b) => (
              <p key={b.contractId} className="balance-row">
                <span className="balance-amount">
                  {b.balance}{' '}
                  <Link href={`/token/${b.contractId}`}>{b.symbol}</Link>
                </span>
              </p>
            ))
          )}

          <hr />

          <h2>token transfers</h2>

          {transfers.length === 0 ? (
            <p>no transfers found</p>
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
                  {txGroups.slice(0, visibleTransfers).map((group) => (
                    <div key={group.txHash} className="tx-group">
                      {group.events.map((t, eventIndex) => (
                        <p key={eventIndex} className="transfer-item">
                          <AddressLink address={t.from} />
                          {' → '}
                          <AddressLink address={t.to} />
                          {': '}
                          {formatAmount(t.amount, t.contractId)}{' '}
                          <Link href={`/token/${t.contractId}`}>{getSymbol(t.contractId)}</Link>
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

                {visibleTransfers < txGroups.length && (
                  <p>
                    <a href="#" onClick={(e) => { e.preventDefault(); setVisibleTransfers(v => v + 10); }}>show more</a>
                  </p>
                )}
              </>
            );
          })()}

          <hr />

          <h2>recent invocations</h2>

          {invocations.length === 0 ? (
            <p>no invocations found</p>
          ) : (
            <>
              <div className="invocation-list">
                {invocations.slice(0, visibleInvocations).map((inv, index) => (
                  <p key={`${inv.txHash}-${index}`} className="invocation-item">
                    <strong>{inv.eventType}</strong>
                    {inv.topics.length > 0 && (
                      <>
                        {' ('}
                        {inv.topics.map((topic, i) => (
                          <span key={i}>
                            {i > 0 && ', '}
                            {renderTopicLink(topic)}
                          </span>
                        ))}
                        {')'}
                      </>
                    )}
                    {inv.value !== null && (
                      <> = {formatTopicValue(inv.value)}</>
                    )}
                    <br />
                    <small>
                      {formatTimestamp(inv.timestamp)} (<Link href={`/tx/${inv.txHash}`}>{inv.txHash?.substring(0, 4)}</Link>)
                      {!inv.inSuccessfulContractCall && <span className="error"> [failed]</span>}
                    </small>
                  </p>
                ))}
              </div>

              {visibleInvocations < invocations.length && (
                <p>
                  <a href="#" onClick={(e) => { e.preventDefault(); setVisibleInvocations(v => v + 10); }}>show more</a>
                </p>
              )}
            </>
          )}

          <p>
            <a href="#" onClick={(e) => { e.preventDefault(); loadData(); }}>refresh</a>
          </p>
        </>
      )}

      <hr />

      <p>
        <Link href="/">new search</Link>
      </p>
    </div>
  );
}

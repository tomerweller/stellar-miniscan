'use client';

import Link from 'next/link';
import NetworkSelector from './NetworkSelector';
import ThemeToggle from './ThemeToggle';
import { useNetwork } from './NetworkContext';

/**
 * Format date for display
 */
function formatLedgerDate(date) {
  if (!date) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Consistent page header for all scan pages
 * Displays title with network dropdown and theme toggle
 */
export default function ScanHeader() {
  const { ledgerRange } = useNetwork();

  const oldestDate = formatLedgerDate(ledgerRange?.oldestDate);
  const latestDate = formatLedgerDate(ledgerRange?.latestDate);

  return (
    <div className="scan-header">
      <div className="scan-header-left">
        <h1><Link href="/">MINI✦SCAN</Link> <span className="beta-badge">beta</span></h1>
        <p className="subtitle">
          a minimal stellar token explorer
          {oldestDate && latestDate && (
            <span className="ledger-range"> · data: {oldestDate} – {latestDate}</span>
          )}
        </p>
      </div>
      <div className="scan-header-right">
        <NetworkSelector />
        <ThemeToggle />
      </div>
    </div>
  );
}

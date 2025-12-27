'use client';

import Link from 'next/link';
import NetworkSelector from './NetworkSelector';
import ThemeToggle from './ThemeToggle';

/**
 * Consistent page header for all scan pages
 * Displays title with network dropdown and theme toggle
 */
export default function ScanHeader() {
  return (
    <div className="scan-header">
      <div className="scan-header-left">
        <h1><Link href="/">MINI✦SCAN</Link> <span className="beta-badge">beta</span></h1>
        <p className="subtitle">a minimal stellar token explorer</p>
      </div>
      <div className="scan-header-right">
        <NetworkSelector />
        <ThemeToggle />
      </div>
    </div>
  );
}

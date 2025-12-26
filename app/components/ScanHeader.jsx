'use client';

import NetworkSelector from './NetworkSelector';

/**
 * Consistent page header for all scan pages
 * Displays title, network selector, and subtitle
 */
export default function ScanHeader() {
  return (
    <>
      <h1>LUMENITOS SCAN</h1>
      <NetworkSelector />
      <p className="subtitle">mini token explorer</p>
    </>
  );
}

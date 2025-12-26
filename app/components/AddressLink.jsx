'use client';

import Link from 'next/link';
import {
  shortenAddressSmall,
  getAddressPath,
} from '@/utils/scan/helpers';

/**
 * Smart address link that routes based on address type
 * - G... addresses -> /account/
 * - C... addresses -> /contract/
 * - L... addresses -> /lp/ (liquidity pools)
 * - B... addresses -> not linked (claimable balance IDs)
 *
 * @param {Object} props
 * @param {string} props.address - The full address
 * @param {string} [props.display] - Optional custom display text
 * @param {boolean} [props.short] - Use shorter format (4..4 vs 6....6)
 */
export default function AddressLink({ address, display, short = true }) {
  if (!address) return <span>?</span>;

  const displayText = display || (short ? shortenAddressSmall(address) : address);

  // B... addresses are claimable balance IDs, not linkable accounts
  if (address.startsWith('B')) {
    return <span className="text-secondary">{displayText} (balance)</span>;
  }

  // All other address types use internal Next.js Link routing
  return (
    <Link href={getAddressPath(address)}>
      {displayText}
    </Link>
  );
}

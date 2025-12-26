'use client';

import { useState } from 'react';
import { useNetwork } from './NetworkContext';

/**
 * Network selector dropdown
 * Shows current network as a clickable label, opens popup to switch networks
 */
export default function NetworkSelector() {
  const { network, setNetwork, isLoading } = useNetwork();
  const [isOpen, setIsOpen] = useState(false);

  if (isLoading) {
    return (
      <p className="network-label testnet">
        loading...
      </p>
    );
  }

  const handleSelect = (selectedNetwork) => {
    setNetwork(selectedNetwork);
    setIsOpen(false);
  };

  const networkClass = network === 'mainnet' ? 'mainnet' : 'testnet';
  const networkLabel = network === 'mainnet' ? 'MAINNET' : 'TESTNET';

  return (
    <div className="network-selector">
      <p
        className={`network-label ${networkClass} clickable`}
        onClick={() => setIsOpen(true)}
        title="Click to change network"
      >
        {networkLabel}
      </p>

      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal network-modal" onClick={(e) => e.stopPropagation()}>
            <h3>select network</h3>

            <div className="network-options">
              <p>
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); handleSelect('testnet'); }}
                  className={network === 'testnet' ? 'selected' : ''}
                >
                  TESTNET
                </a>
                {network === 'testnet' && ' (current)'}
              </p>
              <p>
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); handleSelect('mainnet'); }}
                  className={network === 'mainnet' ? 'selected' : ''}
                >
                  MAINNET
                </a>
                {network === 'mainnet' && ' (current)'}
              </p>
            </div>

            <p>
              <a href="#" onClick={(e) => { e.preventDefault(); setIsOpen(false); }}>cancel</a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

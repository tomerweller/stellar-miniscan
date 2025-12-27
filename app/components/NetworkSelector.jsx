'use client';

import { useState, useEffect, useRef } from 'react';
import { useNetwork } from './NetworkContext';

/**
 * Network selector dropdown
 * Shows current network as a colored badge, opens dropdown to switch networks
 */
export default function NetworkSelector() {
  const { network, setNetwork, isLoading } = useNetwork();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  if (isLoading) {
    return (
      <div className="network-dropdown">
        <button className="network-dropdown-trigger testnet">
          ...
        </button>
      </div>
    );
  }

  const handleSelect = (selectedNetwork) => {
    setNetwork(selectedNetwork);
    setIsOpen(false);
  };

  const networkClass = network === 'mainnet' ? 'mainnet' : 'testnet';
  const networkLabel = network === 'mainnet' ? 'mainnet' : 'testnet';

  return (
    <div className="network-dropdown" ref={dropdownRef}>
      <button
        className={`network-dropdown-trigger ${networkClass}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {networkLabel}
        <span className="arrow">▼</span>
      </button>

      {isOpen && (
        <div className="network-dropdown-menu" role="listbox">
          <button
            className={`network-dropdown-item ${network === 'testnet' ? 'selected' : ''}`}
            onClick={() => handleSelect('testnet')}
            role="option"
            aria-selected={network === 'testnet'}
          >
            <span className="radio" />
            testnet
          </button>
          <button
            className={`network-dropdown-item ${network === 'mainnet' ? 'selected' : ''}`}
            onClick={() => handleSelect('mainnet')}
            role="option"
            aria-selected={network === 'mainnet'}
          >
            <span className="radio" />
            mainnet
          </button>
        </div>
      )}
    </div>
  );
}

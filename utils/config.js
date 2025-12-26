/**
 * Configuration utility for Lumenitos Scan
 * Supports dynamic network switching between testnet and mainnet
 */

// Network configurations
const NETWORKS = {
  testnet: {
    name: 'testnet',
    sorobanRpcUrl: 'https://134-209-117-133.nip.io',
    explorerUrl: 'https://stellar.expert/explorer/testnet',
    passphrase: 'Test SDF Network ; September 2015',
  },
  mainnet: {
    name: 'mainnet',
    sorobanRpcUrl: 'https://157-230-232-173.nip.io',
    explorerUrl: 'https://stellar.expert/explorer/public',
    passphrase: 'Public Global Stellar Network ; September 2015',
  },
};

const STORAGE_KEY = 'lumenitos_scan_network';
const DEFAULT_NETWORK = 'testnet';

/**
 * Get the currently selected network from localStorage
 * @returns {'testnet' | 'mainnet'}
 */
export function getSelectedNetwork() {
  if (typeof window === 'undefined') return DEFAULT_NETWORK;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'mainnet' ? 'mainnet' : 'testnet';
}

/**
 * Set the selected network in localStorage
 * @param {'testnet' | 'mainnet'} network
 */
export function setSelectedNetwork(network) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, network);
  // Dispatch event so components can react to network changes
  window.dispatchEvent(new CustomEvent('network-change', { detail: network }));
}

/**
 * Get network config for a specific network
 * @param {'testnet' | 'mainnet'} network
 */
export function getNetworkConfig(network) {
  return NETWORKS[network] || NETWORKS.testnet;
}

// Dynamic config object that reads current network
const config = {
  get stellar() {
    const network = getSelectedNetwork();
    const networkConfig = NETWORKS[network];
    return {
      network: networkConfig.name,
      sorobanRpcUrl: networkConfig.sorobanRpcUrl,
      explorerUrl: networkConfig.explorerUrl,
    };
  },
  get networkPassphrase() {
    const network = getSelectedNetwork();
    return NETWORKS[network].passphrase;
  },
  get isTestnet() {
    return getSelectedNetwork() !== 'mainnet';
  },
};

export default config;

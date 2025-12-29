/**
 * Configuration utility for Stellar MiniScan
 * Supports dynamic network switching between testnet and mainnet
 */

const env = typeof process !== 'undefined' ? process.env : {};

const getEnvString = (key, fallback) => {
  const value = env[key];
  if (!value || typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
};

const getEnvNumber = (key, fallback) => {
  const value = env[key];
  if (!value || typeof value !== 'string') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const RPC_DEFAULTS = {
  timeoutMs: getEnvNumber('NEXT_PUBLIC_RPC_TIMEOUT_MS', 10000),
  maxRetries: getEnvNumber('NEXT_PUBLIC_RPC_MAX_RETRIES', 2),
  backoffMs: getEnvNumber('NEXT_PUBLIC_RPC_BACKOFF_MS', 300),
  backoffMaxMs: getEnvNumber('NEXT_PUBLIC_RPC_BACKOFF_MAX_MS', 2000),
};

const CAP67DB_DEFAULT_URL = getEnvString(
  'NEXT_PUBLIC_CAP67DB_URL',
  'https://159-65-224-222.sslip.io'
);

// Network configurations
const NETWORKS = {
  testnet: {
    name: 'testnet',
    sorobanRpcUrl: getEnvString(
      'NEXT_PUBLIC_SOROBAN_RPC_URL_TESTNET',
      'https://134-209-117-133.nip.io'
    ),
    explorerUrl: getEnvString(
      'NEXT_PUBLIC_EXPLORER_URL_TESTNET',
      'https://stellar.expert/explorer/testnet'
    ),
    passphrase: 'Test SDF Network ; September 2015',
  },
  mainnet: {
    name: 'mainnet',
    sorobanRpcUrl: getEnvString(
      'NEXT_PUBLIC_SOROBAN_RPC_URL_MAINNET',
      'https://157-230-232-173.nip.io'
    ),
    explorerUrl: getEnvString(
      'NEXT_PUBLIC_EXPLORER_URL_MAINNET',
      'https://stellar.expert/explorer/public'
    ),
    passphrase: 'Public Global Stellar Network ; September 2015',
  },
};

const STORAGE_KEY = 'miniscan_network';
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
      cap67dbUrl: CAP67DB_DEFAULT_URL,
    };
  },
  get rpc() {
    return {
      timeoutMs: RPC_DEFAULTS.timeoutMs,
      maxRetries: RPC_DEFAULTS.maxRetries,
      backoffMs: RPC_DEFAULTS.backoffMs,
      backoffMaxMs: RPC_DEFAULTS.backoffMaxMs,
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

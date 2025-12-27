/**
 * Storage abstractions for Lumenitos Scan
 *
 * Provides localStorage wrappers for caching and persistence.
 * Abstracts storage access to make testing easier.
 */

// Storage keys
const STORAGE_KEYS = {
  trackedAssets: 'scan_tracked_assets',
  tokenMetadataCache: 'scan_token_metadata_cache',
};

/**
 * Default storage implementation using localStorage
 * Can be replaced with a mock for testing
 */
export const defaultStorage = {
  getItem: (key) => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(key);
  },
  setItem: (key, value) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, value);
  },
  removeItem: (key) => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(key);
  },
};

/**
 * Create a storage manager with injectable storage backend
 * @param {object} storage - Storage backend (default: localStorage wrapper)
 * @returns {object} Storage manager instance
 */
export function createStorageManager(storage = defaultStorage) {
  return {
    // ============================================
    // Token Metadata Cache
    // ============================================

    /**
     * Get the cache key for token metadata (namespaced by network)
     * @param {string} network - Network name (testnet/mainnet)
     * @returns {string} Cache key
     */
    getMetadataCacheKey(network) {
      return `${STORAGE_KEYS.tokenMetadataCache}_${network}`;
    },

    /**
     * Get cached token metadata
     * @param {string} contractId - Token contract ID
     * @param {string} network - Network name
     * @returns {object|null} Cached metadata or null
     */
    getCachedMetadata(contractId, network) {
      try {
        const cacheKey = this.getMetadataCacheKey(network);
        const cache = storage.getItem(cacheKey);
        if (!cache) return null;
        const parsed = JSON.parse(cache);
        return parsed[contractId] || null;
      } catch {
        return null;
      }
    },

    /**
     * Store token metadata in cache
     * @param {string} contractId - Token contract ID
     * @param {object} metadata - Metadata to cache
     * @param {string} network - Network name
     */
    setCachedMetadata(contractId, metadata, network) {
      try {
        const cacheKey = this.getMetadataCacheKey(network);
        const cache = storage.getItem(cacheKey);
        const parsed = cache ? JSON.parse(cache) : {};
        parsed[contractId] = metadata;
        storage.setItem(cacheKey, JSON.stringify(parsed));
      } catch {
        // Ignore cache errors
      }
    },

    /**
     * Cache SAC (Stellar Asset Contract) metadata
     * Only caches if not already cached
     * @param {string} contractId - Token contract ID
     * @param {string} sacSymbol - Symbol from SAC event
     * @param {string} sacFullName - Full SAC identifier
     * @param {string} network - Network name
     */
    cacheSacMetadata(contractId, sacSymbol, sacFullName, network) {
      if (!contractId || !sacSymbol) return;
      if (this.getCachedMetadata(contractId, network)) return;
      this.setCachedMetadata(contractId, {
        symbol: sacSymbol,
        name: sacFullName || sacSymbol,
        decimals: 7,
      }, network);
    },

    // ============================================
    // Tracked Assets
    // ============================================

    /**
     * Get the storage key for tracked assets (namespaced by network)
     * @param {string} network - Network name
     * @returns {string} Storage key
     */
    getTrackedAssetsKey(network) {
      return `${STORAGE_KEYS.trackedAssets}_${network}`;
    },

    /**
     * Get manually tracked assets
     * @param {string} network - Network name
     * @returns {Array<{contractId: string, symbol: string, name: string}>}
     */
    getTrackedAssets(network) {
      try {
        const key = this.getTrackedAssetsKey(network);
        const stored = storage.getItem(key);
        return stored ? JSON.parse(stored) : [];
      } catch {
        return [];
      }
    },

    /**
     * Add a tracked asset
     * @param {string} contractId - Token contract ID
     * @param {string} symbol - Token symbol
     * @param {string} name - Token name
     * @param {string} network - Network name
     */
    addTrackedAsset(contractId, symbol, name, network) {
      const key = this.getTrackedAssetsKey(network);
      const assets = this.getTrackedAssets(network);
      if (!assets.find(a => a.contractId === contractId)) {
        assets.push({ contractId, symbol, name });
        storage.setItem(key, JSON.stringify(assets));
      }
    },

    /**
     * Remove a tracked asset
     * @param {string} contractId - Contract ID to remove
     * @param {string} network - Network name
     */
    removeTrackedAsset(contractId, network) {
      const key = this.getTrackedAssetsKey(network);
      const assets = this.getTrackedAssets(network).filter(a => a.contractId !== contractId);
      storage.setItem(key, JSON.stringify(assets));
    },
  };
}

// Default storage manager instance (uses localStorage)
export const storageManager = createStorageManager();

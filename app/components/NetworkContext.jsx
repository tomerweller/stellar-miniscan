'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { getSelectedNetwork, setSelectedNetwork } from '@/utils/config';

const NetworkContext = createContext({
  network: 'testnet',
  setNetwork: () => {},
  isLoading: true,
});

export function useNetwork() {
  return useContext(NetworkContext);
}

export function NetworkProvider({ children }) {
  const [network, setNetworkState] = useState('testnet');
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // Initialize from URL param or localStorage on mount
  useEffect(() => {
    const urlNetwork = searchParams.get('network');
    if (urlNetwork === 'mainnet' || urlNetwork === 'testnet') {
      setNetworkState(urlNetwork);
      setSelectedNetwork(urlNetwork);
    } else {
      // No URL param, use localStorage and add param to URL
      const stored = getSelectedNetwork();
      setNetworkState(stored);

      // Add network param to URL
      const params = new URLSearchParams(searchParams.toString());
      params.set('network', stored);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
    setIsLoading(false);
  }, [searchParams, router, pathname]);

  // Listen for network changes from other tabs/components
  useEffect(() => {
    const handleNetworkChange = (e) => {
      setNetworkState(e.detail);
    };
    window.addEventListener('network-change', handleNetworkChange);
    return () => window.removeEventListener('network-change', handleNetworkChange);
  }, []);

  const setNetwork = useCallback((newNetwork) => {
    setNetworkState(newNetwork);
    setSelectedNetwork(newNetwork);

    // Update URL with network param
    const params = new URLSearchParams(searchParams.toString());
    params.set('network', newNetwork);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [router, searchParams, pathname]);

  return (
    <NetworkContext.Provider value={{ network, setNetwork, isLoading }}>
      {children}
    </NetworkContext.Provider>
  );
}

import { Suspense } from 'react';
import './globals.css';
import { NetworkProvider, ServiceWorkerRegistration } from './components';

export const metadata = {
  title: 'Stellar MiniScan',
  description: 'A Minimal Stellar Token Explorer',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MiniScan',
  },
  openGraph: {
    title: 'Stellar MiniScan',
    description: 'A Minimal Stellar Token Explorer',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Stellar MiniScan',
    description: 'A Minimal Stellar Token Explorer',
  },
};

export const viewport = {
  themeColor: '#4a7c59',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Suspense fallback={null}>
          <NetworkProvider>
            {children}
          </NetworkProvider>
        </Suspense>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}

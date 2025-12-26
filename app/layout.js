import { Suspense } from 'react';
import './globals.css';
import { NetworkProvider, ServiceWorkerRegistration } from './components';

export const metadata = {
  title: 'Lumenitos Scan',
  description: 'A Mini Stellar Token Explorer',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Lumenitos',
  },
  openGraph: {
    title: 'Lumenitos Scan',
    description: 'A Mini Stellar Token Explorer',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Lumenitos Scan',
    description: 'A Mini Stellar Token Explorer',
  },
};

export const viewport = {
  themeColor: '#000000',
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

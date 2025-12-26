# Lumenitos Scan

A minimal Stellar token explorer for viewing SEP-41 token balances, transfers, and transaction details on both testnet and mainnet.

## Overview

Lumenitos Scan is a lightweight block explorer focused on Soroban smart contracts and SEP-41 token activity. It provides:

- **Address exploration** - View token balances and transfer history for any Stellar address (G.../C.../L...)
- **Token tracking** - See recent transfers for any SEP-41 compliant token
- **Transaction details** - Decode and inspect transaction XDRs with human-readable token events
- **Liquidity pool info** - View pool reserves, fees, and share token activity
- **Network switching** - Toggle between testnet and mainnet with URL-based state

## Architecture

```
lumenitos-scan/
├── app/                          # Next.js App Router pages
│   ├── page.jsx                  # Home - search + recent activity
│   ├── layout.js                 # Root layout with NetworkProvider
│   ├── [address]/                # Redirect to appropriate view
│   ├── account/[address]/        # Account balances + transfers
│   ├── contract/[address]/       # Contract invocations + events
│   ├── token/[address]/          # Token metadata + transfers
│   ├── lp/[address]/             # Liquidity pool details
│   ├── tx/[txId]/                # Transaction XDR decoding
│   └── components/               # Shared React components
│       ├── NetworkContext.jsx    # Network state + URL sync
│       ├── NetworkSelector.jsx   # Network switcher UI
│       ├── ScanHeader.jsx        # Page header with network label
│       ├── AddressDisplay.jsx    # Address with copy button
│       ├── AddressLink.jsx       # Smart address linking
│       ├── BalanceList.jsx       # Token balance display
│       └── TransferList.jsx      # Transfer history list
├── utils/
│   ├── config.js                 # Network configs + dynamic switching
│   ├── scan/
│   │   ├── index.js              # RPC calls, event parsing, caching
│   │   ├── helpers.js            # Address formatting, timestamps
│   │   └── operations.js         # XDR operation formatting
│   └── stellar/
│       └── helpers.js            # ScVal parsing, balance formatting
└── public/                       # Static assets
```

### Key Components

**Network Context** (`NetworkContext.jsx`)
- React context for network state (testnet/mainnet)
- Syncs with URL query param (`?network=testnet`)
- Persists selection to localStorage
- Triggers data refetch on network change

**Scan Utilities** (`utils/scan/index.js`)
- Direct JSON-RPC calls to Soroban RPC (custom droplets)
- SEP-41 transfer event parsing with `order: desc` support
- Token metadata caching per-network in localStorage
- XDR decoding via `@stellar/stellar-xdr-json` WASM

**Address Routing**
- `G...` addresses → `/account/` (classic accounts)
- `C...` addresses → `/contract/` or `/token/` (smart contracts)
- `L...` addresses → `/lp/` (liquidity pools)
- 64-char hex → `/tx/` (transaction hashes)

### Data Flow

1. User enters address or navigates to URL
2. NetworkContext provides current network config
3. Page component calls scan utilities (e.g., `getRecentTransfers`)
4. Utilities make RPC calls to network-specific Soroban RPC
5. Events parsed from XDR, metadata fetched and cached
6. UI renders with formatted balances and linked addresses

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deployment

Deployed on Vercel with automatic builds from main branch. Network selection is client-side only - no server-side environment variables needed.

## Tech Stack

- **Next.js 16** - React framework with App Router
- **Stellar SDK** - Soroban RPC client, XDR parsing
- **stellar-xdr-json** - WASM-based XDR to JSON decoder
- **Custom RPC** - Self-hosted Soroban RPC with `order` param support

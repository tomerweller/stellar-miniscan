# Stellar MiniScan

A minimal Stellar token explorer for viewing SEP-41 token balances, token activity, and transaction details on both testnet and mainnet.

## Overview

Stellar MiniScan is a lightweight block explorer focused on Soroban smart contracts and SEP-41/CAP-67 token activity. It provides:

- **Address exploration** - View token balances and activity history for any Stellar address (G.../C.../L...)
- **CAP-67 token events** - Track transfers, mints, burns, clawbacks, and fee events
- **Token tracking** - See recent activity for any SEP-41 compliant token
- **Transaction details** - Decode and inspect transaction XDRs with human-readable token events, CAP-67 fee breakdowns, and memos
- **Liquidity pool info** - View pool reserves, fees, and share token activity
- **Network switching** - Toggle between testnet and mainnet with URL-based state

## Architecture

```
stellar-miniscan/
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
│       ├── TransferList.jsx      # Transfer history list
│       └── TransferItem.jsx      # Individual transfer row
├── utils/
│   ├── config.js                 # Network configs + dynamic switching
│   ├── scan/
│   │   ├── index.js              # High-level API facade + re-exports
│   │   ├── parsers.js            # Pure event parsing functions
│   │   ├── rpc.js                # RPC client with injectable config
│   │   ├── storage.js            # localStorage abstractions
│   │   ├── validation.js         # Pure validation functions
│   │   ├── helpers.js            # Address formatting, timestamps
│   │   └── operations.js         # XDR operation formatting
│   └── stellar/
│       └── helpers.js            # ScVal parsing, balance formatting
├── __tests__/                    # Jest test files
│   ├── parsers.test.mjs          # Event parsing tests
│   ├── rpc-queries.test.mjs      # RPC query structure tests
│   ├── helpers.test.mjs          # Display helper tests
│   ├── scan.test.mjs             # Validation tests
│   └── stellar-helpers.test.mjs  # Balance conversion tests
└── public/                       # Static assets
```

### Key Components

**Network Context** (`NetworkContext.jsx`)
- React context for network state (testnet/mainnet)
- Syncs with URL query param (`?network=testnet`)
- Persists selection to localStorage
- Triggers data refetch on network change

**Scan Utilities** (`utils/scan/`)

The scan module is organized for testability with pure functions and injectable dependencies:

- `parsers.js` - Pure event parsing functions (no side effects, easy to unit test)
- `validation.js` - Pure validation functions for addresses and inputs
- `rpc.js` - RPC client factory with injectable config + topic filter builders
- `storage.js` - localStorage abstraction with injectable storage backend
- `index.js` - High-level API facade that wires everything together

Key capabilities:
- Direct JSON-RPC calls to Soroban RPC via `getEvents` API
- CAP-67 event parsing for transfer, mint, burn, clawback, and fee events
- Event validation to filter non-conforming events (e.g., non-standard topic formats)
- Token metadata caching per-network in localStorage
- Auto-caching of SAC (Stellar Asset Contract) metadata from event topics
- XDR decoding via `@stellar/stellar-xdr-json` WASM

**Address Routing**
- `G...` addresses → `/account/` (classic accounts)
- `C...` addresses → `/contract/` or `/token/` (smart contracts)
- `L...` addresses → `/lp/` (liquidity pools)
- 64-char hex → `/tx/` (transaction hashes)

### Data Flow

1. User enters address or navigates to URL
2. NetworkContext provides current network config
3. Page component calls scan utilities (e.g., `getAccountActivity`)
4. Utilities make RPC calls to network-specific Soroban RPC
5. Events parsed from XDR, metadata fetched and cached
6. UI renders with formatted balances and linked addresses

### CAP-67 Token Events

The explorer uses Stellar's `getEvents` RPC method to query CAP-67 compliant token events:

- **transfer** - `[symbol, from_address, to_address, asset?]`
- **mint** - `[symbol, admin_address, to_address, asset?]`
- **burn** - `[symbol, from_address, asset?]`
- **clawback** - `[symbol, admin_address, from_address, asset?]`
- **fee** - `[symbol, from_address]` (XLM contract only)

Events are validated to ensure topic positions contain proper address ScVals. Non-conforming events (e.g., tokens with custom event formats) are filtered out.

**RPC Query Strategy:**
- Uses single filters with multiple topic patterns (OR logic) for efficiency
- Account activity: 2 filters (token events with 5 topic patterns + fee events)
- Token activity: 1 filter with 4 topic patterns and contractIds
- Network-wide activity falls back to transfers-only if query hits processing limits

### Metadata Caching

Token metadata is cached in localStorage per-network to minimize RPC calls:

- **SEP-41 metadata** - Fetched via `symbol()`, `name()`, `decimals()` contract calls
- **SAC metadata** - Auto-extracted from event topics (4th topic contains `SYMBOL:ISSUER` or `native`)
- **Cache key** - `scan_token_metadata_cache_{network}`

SAC (Stellar Asset Contract) tokens always use 7 decimals, so their metadata can be derived directly from transfer events without additional RPC calls.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Configuration

All configuration is optional and can be set via environment variables at build time:

- `NEXT_PUBLIC_SOROBAN_RPC_URL_TESTNET`
- `NEXT_PUBLIC_SOROBAN_RPC_URL_MAINNET`
- `NEXT_PUBLIC_EXPLORER_URL_TESTNET`
- `NEXT_PUBLIC_EXPLORER_URL_MAINNET`
- `NEXT_PUBLIC_CAP67DB_URL`
- `NEXT_PUBLIC_RPC_TIMEOUT_MS`
- `NEXT_PUBLIC_RPC_MAX_RETRIES`
- `NEXT_PUBLIC_RPC_BACKOFF_MS`
- `NEXT_PUBLIC_RPC_BACKOFF_MAX_MS`

## Testing

The project uses Jest with ES Modules support:

```bash
npm test           # Run unit tests (integration tests are skipped by default)
npm run test:watch # Run tests in watch mode
npm run test:integration # Run live RPC integration tests (requires network)
npm run test:coverage    # Run tests with coverage report
```

### Test Structure

| File | Coverage |
|------|----------|
| `parsers.test.mjs` | Event parsing (transfer, mint, burn, fee events) |
| `rpc-queries.test.mjs` | RPC query structure + regression tests |
| `helpers.test.mjs` | Display formatting (timestamps, amounts) |
| `scan.test.mjs` | Address validation, contract ID extraction |
| `stellar-helpers.test.mjs` | Balance conversion utilities |

### Testing Patterns

The codebase is designed for testability:

- **Pure functions** - `parsers.js` and `validation.js` have no side effects
- **Dependency injection** - `createRpcClient(config)` and `createStorageManager(storage)` accept mock dependencies
- **Regression tests** - RPC query tests verify filter structure to prevent breaking changes

Example of mocking storage:
```javascript
const mockStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};
const storage = createStorageManager(mockStorage);
```

## Deployment

Deployed on Vercel with automatic builds from main branch. Network selection is client-side only - no server-side environment variables needed.

## Tech Stack

- **Next.js 16 / React 19** - Latest React framework with App Router
- **Stellar SDK** - Soroban RPC client, XDR parsing
- **stellar-xdr-json** - WASM-based XDR to JSON decoder
- **Soroban RPC** - Uses `getEvents` API with `order: desc` for recent-first results
- **Jest** - Testing framework with ESM support

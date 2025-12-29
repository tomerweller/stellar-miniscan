# Stellar MiniScan — SPEC

Version: v1

## 1) Overview
Stellar MiniScan is a minimal web explorer for Stellar accounts, Soroban contracts, tokens (SEP-41 / CAP-67), liquidity pools, and transactions on both testnet and mainnet. It emphasizes a fast, lightweight UX rather than full-feature parity with large explorers.

## 2) Goals
- Search-first experience for G/C/L addresses, tx hashes, and ASSET:ISSUER.
- Consistent, readable decoding of transactions and CAP-67 token events.
- Reliable recent-activity feeds with graceful fallback across RPC and indexer.
- Simple network switch and low-friction onboarding.

## 3) Non-Goals
- Full historical indexing or global pagination.
- Custodial features, wallets, signing, or transaction submission.
- Advanced analytics, charting, or account management.

## 4) Users & Use Cases
- Developers validating Soroban activity.
- Token teams checking transfers, mints, burns, and fees.
- Testnet users debugging tx/event formats.
- Liquidity providers inspecting pool metadata and swaps.

## 5) Information Architecture
- `/` Home: search + recent network activity.
- `/account/[G...]`: balances + activity (token + fee events).
- `/contract/[C...]`: contract balance + events + invocations.
- `/token/[C...]`: token metadata + activity.
- `/lp/[L...]`: pool metadata + reserves + activity.
- `/tx/[hash]`: decoded transaction + events.

## 6) Data Sources
- cap67db (mainnet): preferred for recent token activity (faster/cheaper).
- Soroban RPC: fallback for token activity; canonical for tx, ledger, and pool data.
- Stellar SDK: XDR decode + network passphrases.

## 7) Core Flows
- Search input accepts:
  - 64-hex tx hash -> `/tx/[hash]`
  - `ASSET:ISSUER` -> resolve to SAC contract -> `/token/[contract]`
  - `G...` -> `/account/[G...]`
  - `C...` -> `/contract/[C...]`
  - `L...` -> `/lp/[L...]`
- Network toggle updates UI + data sources; persists to localStorage.

## 8) Functional Requirements
- Fetch latest ledger range (data freshness banner).
- Show recent network activity with "show more".
- Show account balances + activity; allow add tracked tokens.
- Decode tx operations + CAP-67 events; include fee/refund.
- Provide external link to stellar.expert per entity.
- Cache token metadata (SEP-41 + SAC) per network in localStorage.

## 9) Error Handling
- RPC timeouts show a friendly message.
- Processing limit errors surfaced as "Too much data to process...".
- cap67db errors fall back to RPC silently (warn only).
- Invalid inputs show clear validation errors.

## 10) Configuration
All config is optional and set via environment variables at build time:
- `NEXT_PUBLIC_SOROBAN_RPC_URL_TESTNET`
- `NEXT_PUBLIC_SOROBAN_RPC_URL_MAINNET`
- `NEXT_PUBLIC_EXPLORER_URL_TESTNET`
- `NEXT_PUBLIC_EXPLORER_URL_MAINNET`
- `NEXT_PUBLIC_CAP67DB_URL`
- `NEXT_PUBLIC_RPC_TIMEOUT_MS`
- `NEXT_PUBLIC_RPC_MAX_RETRIES`
- `NEXT_PUBLIC_RPC_BACKOFF_MS`
- `NEXT_PUBLIC_RPC_BACKOFF_MAX_MS`

Defaults are provided in `utils/config.js`.

## 11) Performance
- Cache metadata to reduce RPC calls.
- RPC timeout + retry/backoff to avoid hanging UI.
- Minimal payload size; no heavy UI frameworks.

## 12) Accessibility & UX
- Keyboard-friendly navigation.
- Clear error + loading states.
- Light/dark theme toggle.

## 13) Security
- Read-only; no private keys or signing.
- No server secrets; all endpoints are public.

## 14) Observability
- Console warnings for recoverable issues.
- User-friendly error messages in UI.

## 15) Testing
- Jest unit tests for parsers/helpers/validation.
- Live RPC integration tests gated by `RUN_INTEGRATION=1`.
- Minimal coverage thresholds for baseline regression safety.

## 16) Deployment
- Vercel deployment; static + client fetch.
- Network selection is client-side only.

## 17) Acceptance Criteria (v1)
- Search routes correctly for all input types.
- Recent activity loads on testnet + mainnet.
- TX page shows operations + events without console errors.
- Account/token/contract/lp pages render and handle errors gracefully.
- Integration tests pass when enabled.

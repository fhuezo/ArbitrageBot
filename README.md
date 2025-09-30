# GalaDEX Arbitrage Bot (TypeScript)

TypeScript scaffolding for a Solana arbitrage bot between Raydium and GalaSwap (aka GalaDEX). It includes a clean architecture, exchange adapters, a simple arbitrage engine, and environment-driven config.

This is a safe starting point: trades default to dry-run. Fill in GalaSwap details and pools, then enable live mode.

## Features
- Modular exchange adapters (`Raydium`, `GalaSwap`)
- Quote + slippage math, thresholding, dry-run mode
- Env-based config, typed and strict
- Build-ready with `tsc`, dev-run with `tsx`

## Quick Start

1) Copy env and edit
```
cp .env.example .env
```
Set `SOLANA_RPC_URL`, `WALLET_KEYPAIR_PATH`, tokens/pairs, and GalaSwap program/pools.

2) Install deps
```
npm install
```

3) Dev run (dry-run by default)
```
npm run dev
```

4) Build + run
```
npm run build
npm start
```

## Live Trading
- Set `DRY_RUN=0` to enable submissions.
- Provide sufficient SOL for fees.
- Consider priority fees and risk controls (slippage, notional caps, min profit).

## GalaSwap Adapter
GalaSwap specifics (program ID, pool state layout, swap instruction format) must be provided. Update `GALADEX_PROGRAM_ID` and implement decoding/tx build in `src/exchanges/galaswap.ts`.

## Structure
- `src/index.ts` — App entry; wiring and loop
- `src/config.ts` — Typed env config
- `src/services/arbitrage.ts` — Arb engine
- `src/exchanges/*` — Exchange adapters
- `src/utils/*` — Solana and math helpers
- `src/types.ts` — Shared types

## Notes
- This repo does not ship keys. Keep your keypair safe.
- Use a reliable mainnet RPC. Websocket streaming can further reduce latency.
- Atomic cross-program swaps are non-trivial; this scaffold uses sequential legs and conservative checks.


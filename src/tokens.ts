import type { TokenInfo } from './types.js';
import dotenv from 'dotenv';

dotenv.config();

const BUILTIN: Record<string, TokenInfo> = {
  SOL: {
    symbol: 'SOL',
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
  },
  USDC: {
    symbol: 'USDC',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
  },
};

function upperSafe(s: string) {
  return (s || '').toUpperCase().trim();
}

function envToken(symbol: string): TokenInfo | null {
  const sym = upperSafe(symbol);
  const mint = process.env[`MINT_${sym}`];
  const decStr = process.env[`DECIMALS_${sym}`];
  if (!mint && !decStr) return null;
  const decimals = decStr ? parseInt(decStr, 10) : BUILTIN[sym]?.decimals ?? 9;
  if (!mint && !BUILTIN[sym]?.mint) {
    throw new Error(`DECIMALS_${sym} set but MINT_${sym} missing and no builtin mint`);
  }
  return {
    symbol: sym,
    mint: mint || BUILTIN[sym]!.mint,
    decimals,
  };
}

// Build registry with env overrides first, then fall back to builtins.
export const TOKENS: Record<string, TokenInfo> = new Proxy({}, {
  get(_target, prop: string) {
    const sym = upperSafe(prop);
    const override = envToken(sym);
    if (override) return override;
    return BUILTIN[sym as keyof typeof BUILTIN];
  }
}) as any as Record<string, TokenInfo>;

export function getToken(symbol: string): TokenInfo | undefined {
  const sym = upperSafe(symbol);
  const ov = envToken(sym);
  if (ov) return ov;
  return BUILTIN[sym];
}


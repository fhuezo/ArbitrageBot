export type PublicKeyString = string;

export type TokenSymbol = string;

export interface TokenInfo {
  symbol: TokenSymbol;
  mint: PublicKeyString;
  decimals: number;
}

export interface PoolState {
  id: string;
  programId: PublicKeyString;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  reserveA: bigint;
  reserveB: bigint;
  feeBps: number;
}

export interface Quote {
  inSymbol: TokenSymbol;
  outSymbol: TokenSymbol;
  inAmount: bigint; // base units
  outAmount: bigint; // base units
  price: number; // out per in (ui units)
  venue: string; // exchange name
  poolId?: string;
}

export interface Opportunity {
  buyVenue: string;
  sellVenue: string;
  inSymbol: TokenSymbol;
  outSymbol: TokenSymbol;
  sizeInBaseUnits: bigint;
  estProfitUsd: number;
  buyQuote: Quote;
  sellQuote: Quote;
}

export interface BuildTxResult {
  description: string;
}


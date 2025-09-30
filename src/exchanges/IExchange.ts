import type { PoolState, Quote } from '../types.js';

export interface IExchange {
  readonly name: string;
  // Optionally filter by a token pair symbols order (e.g., ['SOL','USDC'])
  getPools(pair?: [string, string]): Promise<PoolState[]>;
  getQuote(inSymbol: string, outSymbol: string, inAmount: bigint): Promise<Quote | null>;
  // Build swap tx for a single leg from in->out with specified input amount and minOut.
  buildSwapTransaction(opts: {
    inSymbol: string;
    outSymbol: string;
    inAmount: bigint;
    minOutAmount: bigint;
  }): Promise<{ description: string } | null>;
  // Execute a swap for a single leg (LIVE). Implement per adapter.
  executeSwap(opts: {
    inSymbol: string;
    outSymbol: string;
    inAmount: bigint;
    minOutAmount: bigint;
  }): Promise<{ success: boolean; txId?: string; description: string; outAmount?: bigint }>;
}

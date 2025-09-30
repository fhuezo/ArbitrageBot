import type { IExchange } from './IExchange.js';
import type { PoolState, Quote } from '../types.js';
import { config } from '../config.js';
import { toUi, fromUi, applySlippage } from '../utils/math.js';
import { getToken } from '../tokens.js';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

function classKey(symbol: string): string | null {
  const s = (symbol || '').toUpperCase();
  if (s === 'GALA') return 'GALA|Unit|none|none';
  if (s === 'GSOL' || s === 'SOL') return 'GSOL|Unit|none|none';
  if (s === 'USDC' || s === 'GUSDC') return 'GUSDC|Unit|none|none';
  if (s === 'USDT' || s === 'GUSDT') return 'GUSDT|Unit|none|none';
  return null;
}

let gswap: GSwap | null = null;
async function getClient(): Promise<GSwap> {
  if (gswap) return gswap;
  if (!config.galadexPrivateKey) throw new Error('GalaSwap SDK: GALADEX_PRIVATE_KEY missing');
  if (!config.galadexWalletAddress) throw new Error('GalaSwap SDK: GALADEX_WALLET_ADDRESS missing');
  gswap = new GSwap({
    signer: new PrivateKeySigner(config.galadexPrivateKey),
    walletAddress: config.galadexWalletAddress,
    gatewayBaseUrl: 'https://gateway-mainnet.galachain.com',
    dexContractBasePath: '/api/asset/dexv3-contract',
    tokenContractBasePath: '/api/asset/token-contract',
    bundlerBaseUrl: 'https://bundle-backend-prod1.defi.gala.com',
    bundlingAPIBasePath: '/bundle',
    dexBackendBaseUrl: 'https://dex-backend-prod1.defi.gala.com',
    transactionWaitTimeoutMs: 300000,
  });
  return gswap;
}

export class GalaSwapExchange implements IExchange {
  public readonly name = 'GalaSwap';
  private pools: PoolState[] = [];

  async getPools(): Promise<PoolState[]> { return this.pools; }

  async getQuote(inSymbol: string, outSymbol: string, inAmount: bigint): Promise<Quote | null> {
    try {
      const inInfo = getToken(inSymbol);
      const outInfo = getToken(outSymbol);
      const inKey = classKey(inSymbol);
      const outKey = classKey(outSymbol);
      if (!inInfo || !outInfo || !inKey || !outKey) return null;
      const amountUi = toUi(inAmount, inInfo.decimals);
      const feeTier = config.galadexFeeTier ?? 10000; // default per your config
      const cli = await getClient();
      const q: any = await cli.quoting.quoteExactInput(inKey, outKey, String(amountUi), feeTier);
      const outUi = Number(q?.amountOut ?? q?.outTokenAmount ?? 0);
      if (!outUi || !Number.isFinite(outUi)) return null;
      const outAmount = fromUi(outUi, outInfo.decimals);
      const price = outUi / (amountUi || 1);
      return { inSymbol, outSymbol, inAmount, outAmount, price, venue: this.name };
    } catch (e) {
      console.warn('[GalaSwap SDK] quote error:', e);
      return null;
    }
  }

  async buildSwapTransaction(): Promise<{ description: string } | null> {
    return { description: 'GalaSwap SDK used; no manual tx build.' };
  }

  async executeSwap(opts: { inSymbol: string; outSymbol: string; inAmount: bigint; minOutAmount: bigint }): Promise<{ success: boolean; txId?: string; description: string; outAmount?: bigint }> {
    try {
      const inInfo = getToken(opts.inSymbol);
      const outInfo = getToken(opts.outSymbol);
      const inKey = classKey(opts.inSymbol);
      const outKey = classKey(opts.outSymbol);
      if (!inInfo || !outInfo || !inKey || !outKey) return { success: false, description: 'Unsupported tokens' };
      const amountUi = toUi(opts.inAmount, inInfo.decimals);
      const minOutUi = toUi(opts.minOutAmount, outInfo.decimals);
      const feeTier = config.galadexFeeTier ?? 10000;
      const cli = await getClient();
      const res: any = await cli.swaps.swap(inKey, outKey, feeTier, { exactIn: String(amountUi), amountOutMinimum: String(minOutUi) }, config.galadexWalletAddress!);
      const txId = res?.transactionId || res?.txId || undefined;
      // Optionally wait; for now return submit id
      return { success: true, txId, description: 'GalaSwap SDK submitted' };
    } catch (e: any) {
      return { success: false, description: `GalaSwap SDK swap error: ${e?.message || e}` };
    }
  }
}

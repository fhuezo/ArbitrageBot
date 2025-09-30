import type { IExchange } from './IExchange.js';
import type { PoolState, Quote } from '../types.js';
import { config } from '../config.js';
import { toUi, constantProductOutAmount } from '../utils/math.js';
import { TOKENS, getToken } from '../tokens.js';
import { getConnection, getDefaultKeypair } from '../utils/solana.js';
import { fetchWithRetry, validatePriceData, NetworkError } from '../utils/network.js';
import BN from 'bn.js';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { Router, TxVersion, TokenAmount, toToken } from '@raydium-io/raydium-sdk-v2';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Light integration with Raydium SDK v2 for CLMM price; falls back to mock if unavailable
let _raydiumSdk: any | null = null;
async function loadRaydium() {
  if (_raydiumSdk) return _raydiumSdk;
  try {
    const mod = await import('@raydium-io/raydium-sdk-v2');
    _raydiumSdk = mod;
    return _raydiumSdk;
  } catch (e) {
    console.warn('[Raydium] SDK v2 not available:', e);
    return null;
  }
}

export class RaydiumExchange implements IExchange {
  public readonly name = 'Raydium';
  private pools: PoolState[] = [];
  private clmmPriceCache: { poolId: string; ts: number; priceAB: number; mintA: string; mintB: string; decA: number; decB: number } | null = null;

  private async fetchClmmPrice(): Promise<typeof this.clmmPriceCache | null> {
    const poolId = config.raydiumGalaSolPool || process.env.RAYDIUM_GALA_SOL_POOL;
    if (!poolId) return null;
    
    try {
      const sdk = await loadRaydium();
      if (!sdk?.Raydium && !sdk?.c) {
        console.error('[Raydium] SDK not available, cannot fetch CLMM prices');
        return null;
      }
      
      const RaydiumCtor = sdk.Raydium || sdk.c;
      const connection = getConnection();
      const raydium = await RaydiumCtor.load({ connection, cluster: 'mainnet-beta' as any });
      const clmm = raydium.clmm;
      const info: any = await clmm.getRpcClmmPoolInfo({ poolId });
      
      const rawPrice = info?.currentPrice;
      const priceAB = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice?.toString?.() || 0);
      
      let mintA = '';
      let mintB = '';
      let decA = 0;
      let decB = 0;
      
      if (info?.mintA) {
        if (typeof info.mintA === 'object' && 'mint' in info.mintA) {
          mintA = info.mintA.mint?.toString?.() || '';
          decA = typeof info.mintA.decimals === 'number' ? info.mintA.decimals : 0;
        } else if (info.mintA?.toString) {
          mintA = info.mintA.toString();
        }
      }
      
      if (info?.mintB) {
        if (typeof info.mintB === 'object' && 'mint' in info.mintB) {
          mintB = info.mintB.mint?.toString?.() || '';
          decB = typeof info.mintB.decimals === 'number' ? info.mintB.decimals : 0;
        } else if (info.mintB?.toString) {
          mintB = info.mintB.toString();
        }
      }
      
      if (!decA && mintA) {
        if (mintA === (TOKENS.GALA?.mint || '')) decA = TOKENS.GALA?.decimals || decA;
        if (mintA === (TOKENS.SOL?.mint || '')) decA = TOKENS.SOL?.decimals || decA;
      }
      if (!decB && mintB) {
        if (mintB === (TOKENS.GALA?.mint || '')) decB = TOKENS.GALA?.decimals || decB;
        if (mintB === (TOKENS.SOL?.mint || '')) decB = TOKENS.SOL?.decimals || decB;
      }
      
      // Validate the price data before using it
      if (!priceAB || priceAB <= 0) {
        console.error('[Raydium] Invalid price data from CLMM:', priceAB);
        return null;
      }
      
      if (!validatePriceData(priceAB, 'GALA/SOL-Raydium')) {
        console.error('[Raydium] Price data failed validation, refusing to use potentially fake data');
        return null;
      }
      
      this.clmmPriceCache = { poolId, ts: Date.now(), priceAB, mintA, mintB, decA, decB };
      console.log(`[Raydium] ✓ Valid CLMM price fetched: ${priceAB}`);
      return this.clmmPriceCache;
      
    } catch (e) {
      if (e instanceof NetworkError) {
        console.error('[Raydium] Network error fetching CLMM price - refusing fallback to mock data');
      } else {
        console.error('[Raydium] CLMM price fetch failed - refusing fallback to mock data:', e);
      }
      return null;
    }
  }

  async getPools(pair?: [string, string]): Promise<PoolState[]> {
    const live = await this.fetchClmmPrice();
    if (live) {
      const tokenAIsGala = (TOKENS.GALA?.mint === live.mintA) || false;
      const galaTok = getToken('GALA');
      const solTok = getToken('SOL')!;
      const tokenA = tokenAIsGala ? (galaTok ?? solTok) : solTok;
      const tokenB = tokenAIsGala ? solTok : (galaTok ?? solTok);
      this.pools = [{
        id: live.poolId,
        programId: 'RaydiumCLMM',
        tokenA,
        tokenB,
        reserveA: 1_000_000n,
        reserveB: 1_000_000n,
        feeBps: 30,
      }];
    } else {
      console.error('[Raydium] No valid price data available - refusing to use mock data that could lead to false arbitrage signals');
      this.pools = []; // Empty pools instead of mock data
    }
    
    if (!pair) return this.pools;
    const [a, b] = pair;
    return this.pools.filter(
      (p) =>
        (p.tokenA.symbol === a && p.tokenB.symbol === b) ||
        (p.tokenA.symbol === b && p.tokenB.symbol === a)
    );
  }

  async getQuote(inSymbol: string, outSymbol: string, inAmount: bigint): Promise<Quote | null> {
    const live = await this.fetchClmmPrice();
    if (live) {
      const symA = (TOKENS.GALA?.mint === live.mintA) ? 'GALA' : 'SOL';
      const inIsA = inSymbol === symA;
      const inDec = inIsA ? live.decA : live.decB;
      const outDec = inIsA ? live.decB : live.decA;
      const inUi = toUi(inAmount, inDec);
      const price = inIsA ? live.priceAB : (live.priceAB > 0 ? 1 / live.priceAB : 0);
      const outUi = inUi * price;
      const outAmount = BigInt(Math.floor(outUi * 10 ** outDec));
      const priceUi = outUi / (inUi || 1);
      
      // Validate the calculated price
      if (!validatePriceData(priceUi, `${inSymbol}/${outSymbol}-Raydium`)) {
        console.error('[Raydium] Calculated price failed validation, refusing to provide quote');
        return null;
      }
      
      return {
        inSymbol,
        outSymbol,
        inAmount,
        outAmount,
        price: priceUi,
        venue: this.name,
        poolId: live.poolId,
      };
    }

    console.error('[Raydium] No live price data available, cannot provide quote');
    return null;
  }

  async buildSwapTransaction(): Promise<{ description: string } | null> {
    return { description: 'Raydium swap tx (stub). Implement via SDK.' };
  }

  async executeSwap(opts: { inSymbol: string; outSymbol: string; inAmount: bigint; minOutAmount: bigint }): Promise<{ success: boolean; txId?: string; description: string; outAmount?: bigint }> {
    try {
      const { inSymbol, outSymbol, inAmount, minOutAmount } = opts;
      const inTok = getToken(inSymbol);
      const outTok = getToken(outSymbol);
      if (!inTok || !outTok) return { success: false, description: `Unknown tokens ${inSymbol}/${outSymbol}` };

      const connection = getConnection();
      const owner = getDefaultKeypair();

      // Use Jupiter API for reliable DEX aggregation
      const jupiterQuoteUrl = `https://quote-api.jup.ag/v6/quote`;
      const quoteParams = new URLSearchParams({
        inputMint: inTok.mint,
        outputMint: outTok.mint,
        amount: inAmount.toString(),
        slippageBps: (config.slippageBps || 50).toString(),
        onlyDirectRoutes: 'false',
        asLegacyTransaction: 'false'
      });

      // Get quote from Jupiter with retry logic
      const quoteResponse = await fetchWithRetry(`${jupiterQuoteUrl}?${quoteParams}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!quoteResponse.ok) {
        const errorText = await quoteResponse.text();
        console.error(`[Jupiter] Quote error ${quoteResponse.status}:`, errorText);
        return { success: false, description: `Jupiter quote failed: ${quoteResponse.status}` };
      }
      const quoteResult = await quoteResponse.json();

      if (!quoteResult || !quoteResult.outAmount) {
        return { success: false, description: 'No viable Jupiter route' };
      }

      const outAmount = BigInt(quoteResult.outAmount);
      if (outAmount < minOutAmount) {
        return { success: false, description: `Jupiter quote ${outAmount} < required ${minOutAmount}` };
      }

      // Get swap transaction from Jupiter with retry logic
      const swapRequestBody = {
        quoteResponse: quoteResult,
        userPublicKey: owner.publicKey.toString(),
        wrapAndUnwrapSol: true,
      };

      // Add priority fee (use only one of the fee options, not both)
      if (config.priorityFeeMicrolamports && config.priorityFeeMicrolamports > 0) {
        (swapRequestBody as any).prioritizationFeeLamports = config.priorityFeeMicrolamports;
      } else if (config.computeUnitPriceMicrolamports && config.computeUnitPriceMicrolamports > 0) {
        (swapRequestBody as any).computeUnitPriceMicroLamports = config.computeUnitPriceMicrolamports;
      }

      const swapResponse = await fetchWithRetry('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(swapRequestBody),
      });

      if (!swapResponse.ok) {
        const errorText = await swapResponse.text();
        console.error(`[Jupiter] Swap error ${swapResponse.status}:`, errorText);
        return { success: false, description: `Jupiter swap failed: ${swapResponse.status}` };
      }

      const { swapTransaction } = await swapResponse.json();
      
      // Deserialize and sign the transaction
      const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      
      // Sign the transaction
      transaction.sign([owner]);

      // Send and confirm the transaction
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        preflightCommitment: 'confirmed'
      });

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');

      return { 
        success: true, 
        txId: signature, 
        description: 'Jupiter swap submitted',
        outAmount: outAmount
      };
    } catch (e: any) {
      console.error('[Jupiter]', e);
      return { success: false, description: `Jupiter swap error: ${e?.message || String(e)}` };
    }
  }
}

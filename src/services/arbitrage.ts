import type { IExchange } from '../exchanges/IExchange.js';
import type { Opportunity, Quote } from '../types.js';
import { config } from '../config.js';
import { applySlippage, fromUi } from '../utils/math.js';
import { getToken } from '../tokens.js';
import { validateArbitrageOpportunity, validateConnectivity } from '../utils/network.js';

function bestOpp(
  buy: Quote | null,
  sell: Quote | null,
  notionalUsd: number,
  decimalsIn: number,
  priceUsd: number
): Opportunity | null {
  if (!buy || !sell) return null;
  
  const delta = sell.price - buy.price; // out per in (ui units)
  if (delta <= 0) return null;
  
  const sizeInBaseUnits = fromUi(notionalUsd / priceUsd, decimalsIn);
  const avg = (sell.price + buy.price) / 2;
  const edgeFrac = avg > 0 ? (delta / avg) : 0;
  const estProfitUsd = edgeFrac * notionalUsd;
  const profitPercentage = edgeFrac * 100;
  
  // Validate the arbitrage opportunity is realistic
  const pair = `${buy.inSymbol}/${buy.outSymbol}`;
  if (!validateArbitrageOpportunity(estProfitUsd, profitPercentage, buy.price, sell.price, pair)) {
    console.warn(`[Arbitrage] Rejected unrealistic opportunity: ${profitPercentage.toFixed(2)}% profit, $${estProfitUsd.toFixed(2)} for ${pair}`);
    return null;
  }
  
  if (config.minProfitBps !== undefined) {
    const avg2 = (sell.price + buy.price) / 2;
    const bps = avg2 > 0 ? (delta / avg2) * 10_000 : 0;
    if (bps < config.minProfitBps) return null;
  }
  
  if (estProfitUsd < config.minProfitUsd) return null;
  
  return {
    buyVenue: buy.venue,
    sellVenue: sell.venue,
    inSymbol: buy.inSymbol,
    outSymbol: buy.outSymbol,
    sizeInBaseUnits,
    estProfitUsd,
    buyQuote: buy,
    sellQuote: sell,
  };
}

export class ArbitrageEngine {
  private dailyCount = 0;
  private dayKey = new Date().toISOString().slice(0, 10);

  private rollDailyWindow() {
    const k = new Date().toISOString().slice(0, 10);
    if (k !== this.dayKey) {
      this.dayKey = k;
      this.dailyCount = 0;
    }
  }

  private canExecuteToday(): boolean {
    this.rollDailyWindow();
    const lim = config.maxDailyTrades;
    if (lim === undefined) return true;
    return this.dailyCount < lim;
  }
  private computeTradeSize(inSymbol: string): bigint {
    if (inSymbol.toUpperCase() === 'SOL') {
      const dec = getToken('SOL')!.decimals;
      const sizeSol = config.maxTradeSizeSol ?? 0.01;
      return fromUi(sizeSol, dec);
    }
    const dec = getToken(inSymbol)?.decimals ?? 9;
    return fromUi(1, dec);
  }

  constructor(
    private readonly a: IExchange,
    private readonly b: IExchange
  ) {}

  async tick(pair: [string, string], referencePriceUsd = 1): Promise<Opportunity | null> {
    const [base, quote] = pair;
    const baseInfo = getToken(base);
    const quoteInfo = getToken(quote);
    if (!baseInfo || !quoteInfo) {
      console.warn(`Unknown token(s) for pair ${base}/${quote}. Update src/tokens.ts`);
      return null;
    }
    
    // Periodically validate connectivity (every 10 ticks approximately)
    if (Math.random() < 0.1) {
      console.log('[Arbitrage] Performing periodic connectivity check...');
      const isConnected = await validateConnectivity();
      if (!isConnected) {
        console.error('[Arbitrage] Connectivity validation failed - skipping arbitrage cycle');
        return null;
      }
    }
    
    const sizeUsd = config.maxNotionalUsd;
    const probeIn = fromUi(1, baseInfo.decimals);
    const aBuy = await this.a.getQuote(base, quote, probeIn);
    const bSell = await this.b.getQuote(base, quote, probeIn);
    const opp1 = bestOpp(aBuy, bSell, sizeUsd, baseInfo.decimals, referencePriceUsd);

    const aSell = await this.a.getQuote(quote, base, fromUi(1, quoteInfo.decimals));
    const bBuy = await this.b.getQuote(quote, base, fromUi(1, quoteInfo.decimals));
    const opp2 = bestOpp(bBuy, aSell, sizeUsd, quoteInfo.decimals, 1 / referencePriceUsd);

    let best: Opportunity | null = null;
    const notionalUsd = sizeUsd;
    if (bBuy && aBuy) {
      const product = bBuy.price * aBuy.price;
      const edge = product - 1;
      const estProfitUsd = edge * notionalUsd;
      const bpsEdge = edge * 10_000;
      const passBps = config.minProfitBps === undefined || bpsEdge >= config.minProfitBps;
      if (edge > 0 && estProfitUsd >= config.minProfitUsd && passBps) {
        best = {
          buyVenue: bBuy.venue,
          sellVenue: aBuy.venue,
          inSymbol: quote,
          outSymbol: base,
          sizeInBaseUnits: fromUi(notionalUsd / (referencePriceUsd || 1), quoteInfo.decimals),
          estProfitUsd,
          buyQuote: bBuy,
          sellQuote: aBuy,
        };
      }
    }
    if (aSell && bSell) {
      const product = aSell.price * bSell.price;
      const edge = product - 1;
      const estProfitUsd = edge * notionalUsd;
      const bpsEdge = edge * 10_000;
      const passBps = config.minProfitBps === undefined || bpsEdge >= config.minProfitBps;
      if (edge > 0 && estProfitUsd >= config.minProfitUsd && passBps) {
        if (!best || estProfitUsd > best.estProfitUsd) {
          best = {
            buyVenue: aSell.venue,
            sellVenue: bSell.venue,
            inSymbol: quote,
            outSymbol: base,
            sizeInBaseUnits: fromUi(notionalUsd / (referencePriceUsd || 1), quoteInfo.decimals),
            estProfitUsd,
            buyQuote: aSell,
            sellQuote: bSell,
          };
        }
      }
    }

    try {
      const dbg = (q: Quote | null) => q ? `${q.venue} ${q.inSymbol}->${q.outSymbol} price=${q.price.toFixed(6)}` : 'null';
      console.log(`[quotes] ${dbg(aBuy)} | ${dbg(bSell)}`);
      console.log(`[quotes] reverse ${dbg(bBuy)} | ${dbg(aSell)}`);
      if (bBuy && aBuy) console.log(`[roundtrip B->A] product=${(bBuy.price * aBuy.price).toFixed(6)}`);
      if (aSell && bSell) console.log(`[roundtrip A->B] product=${(aSell.price * bSell.price).toFixed(6)}`);
    } catch {}

    const opp = best ?? opp1 ?? opp2 ?? null;
    return opp as Opportunity | null;
  }

  async execute(opp: Opportunity): Promise<void> {
    if (!this.canExecuteToday()) {
      console.log(`[LIVE] Daily trade limit reached (${config.maxDailyTrades}). Skipping.`);
      return;
    }
    if (config.dryRun) {
      console.log(`[DRY] Would execute: buy on ${opp.buyVenue}, sell on ${opp.sellVenue}, estProfitUsd=${opp.estProfitUsd.toFixed(3)}`);
      return;
    }

    const exA = this.a;
    const exB = this.b;
    const buyEx = exA.name === opp.buyVenue ? exA : exB;
    const sellEx = exA.name === opp.sellVenue ? exA : exB;

    const inSymbol = opp.inSymbol;
    const outSymbol = opp.outSymbol;
    const inAmount = this.computeTradeSize(inSymbol);

    const buyQuote = await buyEx.getQuote(inSymbol, outSymbol, inAmount);
    if (!buyQuote) {
      console.warn(`[LIVE] Buy quote unavailable on ${buyEx.name}`);
      return;
    }
    const minOutBuy = applySlippage(buyQuote.outAmount, config.slippageBps, 'out');
    const buyRes = await buyEx.executeSwap({ inSymbol, outSymbol, inAmount, minOutAmount: minOutBuy });
    if (!buyRes.success) {
      console.warn(`[LIVE] Buy leg failed on ${buyEx.name}: ${buyRes.description}`);
      return;
    }
    // Count a trade as soon as we've taken inventory risk on the buy leg
    this.dailyCount += 1;
    console.log(`[LIVE] Buy leg succeeded on ${buyEx.name}. tx=${buyRes.txId || 'n/a'} dailyCount=${this.dailyCount}`);
    const receivedOut = buyQuote.outAmount; // optimistic; adapter may return exact out in future

    const sellQuote = await sellEx.getQuote(outSymbol, inSymbol, receivedOut);
    if (!sellQuote) {
      console.warn(`[LIVE] Sell quote unavailable on ${sellEx.name}`);
      return;
    }
    const minOutSell = applySlippage(sellQuote.outAmount, config.slippageBps, 'out');
    const sellRes = await sellEx.executeSwap({ inSymbol: outSymbol, outSymbol: inSymbol, inAmount: receivedOut, minOutAmount: minOutSell });
    if (!sellRes.success) {
      console.warn(`[LIVE] Sell leg failed on ${sellEx.name}: ${sellRes.description}`);
      console.warn(`[LIVE] Prior buy tx was ${buyRes.txId || 'n/a'} on ${buyEx.name}`);
      return;
    }
    console.log(`[LIVE] Executed both legs. buyTx=${buyRes.txId || 'n/a'} sellTx=${sellRes.txId || 'n/a'}`);
    
    // Add 1 second delay after Jupiter transactions (via Raydium exchange) to respect rate limits
    if (sellEx.name === 'Raydium') {
      console.log('[LIVE] Waiting 1s after Jupiter transaction to respect rate limits...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

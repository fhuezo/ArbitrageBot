import { config } from './config.js';
import { RaydiumExchange } from './exchanges/raydium.js';
import { GalaSwapExchange } from './exchanges/galaswap.js';
import { ArbitrageEngine } from './services/arbitrage.js';
import { validateConnectivity } from './utils/network.js';

async function main() {
  console.log('Starting GalaDEX Arbitrage Bot (TypeScript)');
  console.log(`RPC: ${config.rpcUrl}`);
  console.log(`Mode: ${config.dryRun ? 'DRY-RUN' : 'LIVE'}`);
  
  // Initial connectivity validation
  console.log('Validating network connectivity...');
  const isConnected = await validateConnectivity();
  if (!isConnected) {
    console.error('❌ Network connectivity validation failed. Bot will not start.');
    console.error('Please check your internet connection and ensure APIs are accessible.');
    process.exit(1);
  }
  console.log('✅ Network connectivity validated successfully');

  const raydium = new RaydiumExchange();
  const gala = new GalaSwapExchange();
  const engine = new ArbitrageEngine(raydium, gala);

  const [base, quote] = config.tokens as [string, string];
  console.log(`Pair: ${base}/${quote}`);

  const loop = async () => {
    try {
      const opp = await engine.tick([base, quote], 1);
      if (opp) {
        console.log(
          `Opp: Buy ${opp.inSymbol}->${opp.outSymbol} on ${opp.buyVenue}, sell on ${opp.sellVenue}. EstProfitUsd=${opp.estProfitUsd.toFixed(
            4
          )}`
        );
        await engine.execute(opp);
      } else {
        console.log('No opportunity.');
      }
    } catch (e) {
      console.error('Tick error', e);
    }
  };

  // Simple polling loop
  await loop();
  const intervalMs = config.scanIntervalSeconds ? Math.floor(config.scanIntervalSeconds * 1000) : config.pollIntervalMs;
  setInterval(loop, intervalMs);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

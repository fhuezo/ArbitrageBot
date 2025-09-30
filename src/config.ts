import dotenv from 'dotenv';

dotenv.config();

function getEnv(name: string, def?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (def !== undefined) return def;
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

export interface Config {
  rpcUrl: string;
  walletPath: string;
  tokens: string[];
  slippageBps: number;
  minProfitUsd: number;
  minProfitBps?: number;
  maxNotionalUsd: number;
  maxTradeSizeSol?: number;
  pollIntervalMs: number;
  scanIntervalSeconds?: number;
  dryRun: boolean;
  priorityFeeMicrolamports: number;
  computeUnitLimit: number;
  computeUnitPriceMicrolamports: number;
  raydiumForcePools?: string[];
  raydiumGalaSolPool?: string;
  galadexProgramId?: string;
  galadexForcePools?: string[];
  galadexApiBase?: string;
  galadexPrivateKey?: string;
  galadexWalletAddress?: string;
  galadexFeeTier?: number;
  maxDailyTrades?: number;
}

export const config: Config = {
  rpcUrl: getEnv('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
  walletPath: getEnv('WALLET_KEYPAIR_PATH', './keypair.json'),
  tokens: getEnv('TOKENS', 'SOL,USDC').split(',').map((s) => s.trim()),
  slippageBps: parseInt(getEnv('SLIPPAGE_BPS', '50'), 10),
  minProfitUsd: parseFloat(getEnv('MIN_PROFIT_USD', '2.5')),
  minProfitBps: process.env.MIN_PROFIT_BPS ? parseInt(process.env.MIN_PROFIT_BPS, 10) : undefined,
  maxNotionalUsd: parseFloat(getEnv('MAX_NOTIONAL_USD', '200')),
  maxTradeSizeSol: process.env.MAX_TRADE_SIZE_SOL ? parseFloat(process.env.MAX_TRADE_SIZE_SOL) : undefined,
  pollIntervalMs: parseInt(getEnv('POLL_INTERVAL_MS', '1200'), 10),
  scanIntervalSeconds: process.env.SCAN_INTERVAL_SECONDS ? parseFloat(process.env.SCAN_INTERVAL_SECONDS) : undefined,
  dryRun: getEnv('DRY_RUN', '1') === '1',
  priorityFeeMicrolamports: parseInt(getEnv('PRIORITY_FEE_MICROLAMPORTS', '0') || '0', 10),
  computeUnitLimit: parseInt(getEnv('COMPUTE_UNIT_LIMIT', '1200000'), 10),
  computeUnitPriceMicrolamports: parseInt(getEnv('COMPUTE_UNIT_PRICE_MICROLAMPORTS', '0'), 10),
  raydiumForcePools: (process.env.RAYDIUM_FORCE_POOLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  raydiumGalaSolPool: process.env.RAYDIUM_GALA_SOL_POOL || undefined,
  galadexProgramId: process.env.GALADEX_PROGRAM_ID || undefined,
  galadexForcePools: (process.env.GALADEX_FORCE_POOLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  galadexApiBase: process.env.GALADEX_API_BASE || undefined,
  galadexPrivateKey: process.env.GALADEX_PRIVATE_KEY || undefined,
  galadexWalletAddress: process.env.GALADEX_WALLET_ADDRESS || undefined,
  galadexFeeTier: process.env.GALADEX_FEE_TIER ? parseInt(process.env.GALADEX_FEE_TIER, 10) : undefined,
  maxDailyTrades: process.env.MAX_DAILY_TRADES ? parseInt(process.env.MAX_DAILY_TRADES, 10) : undefined,
};

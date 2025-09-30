// Using native fetch (Node.js 18+)

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  timeout: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  timeout: 10000   // 10 seconds
};

export class NetworkError extends Error {
  constructor(message: string, public originalError?: Error) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Exponential backoff delay calculation
 */
function calculateDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  const delay = baseDelay * Math.pow(2, attempt - 1);
  return Math.min(delay + Math.random() * 1000, maxDelay); // Add jitter
}

/**
 * Fetch with retry logic and timeout
 */
export async function fetchWithRetry(
  url: string, 
  options: RequestInit = {}, 
  retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= retryOptions.maxRetries + 1; attempt++) {
    try {
      console.log(`[Network] Attempting ${url} (attempt ${attempt})`);
      
      // Add timeout to fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), retryOptions.timeout);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      console.log(`[Network] Success ${url} (attempt ${attempt})`);
      return response;
      
    } catch (error) {
      lastError = error as Error;
      console.warn(`[Network] Failed ${url} (attempt ${attempt}): ${lastError.message}`);
      
      // Don't retry on last attempt
      if (attempt <= retryOptions.maxRetries) {
        const delay = calculateDelay(attempt, retryOptions.baseDelay, retryOptions.maxDelay);
        console.log(`[Network] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw new NetworkError(`Failed to fetch ${url} after ${retryOptions.maxRetries + 1} attempts`, lastError!);
}

/**
 * Test connectivity to critical APIs
 */
export async function validateConnectivity(): Promise<boolean> {
  const criticalEndpoints = [
    'https://api-v3.raydium.io/mint/list',
    'https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000'
  ];
  
  console.log('[Network] Validating connectivity to critical APIs...');
  
  for (const endpoint of criticalEndpoints) {
    try {
      const response = await fetchWithRetry(endpoint, {}, {
        maxRetries: 1,
        baseDelay: 1000,
        maxDelay: 5000,
        timeout: 5000
      });
      
      if (!response.ok) {
        console.error(`[Network] Connectivity check failed for ${endpoint}: HTTP ${response.status}`);
        return false;
      }
      
      console.log(`[Network] ✓ ${endpoint} is reachable`);
    } catch (error) {
      console.error(`[Network] Connectivity check failed for ${endpoint}:`, error);
      return false;
    }
  }
  
  console.log('[Network] ✓ All critical APIs are reachable');
  return true;
}

/**
 * Validate that price data looks realistic (not mock/fallback data)
 */
export function validatePriceData(price: number, tokenPair: string): boolean {
  // Basic sanity checks
  if (!price || price <= 0 || !isFinite(price)) {
    console.warn(`[Validation] Invalid price for ${tokenPair}: ${price}`);
    return false;
  }
  
  // Check for suspiciously round numbers that might indicate mock data
  if (price === 1 || price === 0.001 || price === 1000) {
    console.warn(`[Validation] Suspicious round price for ${tokenPair}: ${price} (possible mock data)`);
    return false;
  }
  
  // Check for unrealistic price ranges
  if (price > 1000000 || price < 0.000000001) {
    console.warn(`[Validation] Price out of realistic range for ${tokenPair}: ${price}`);
    return false;
  }
  
  return true;
}

/**
 * Validate arbitrage opportunity is realistic
 */
export function validateArbitrageOpportunity(
  profit: number, 
  profitPercentage: number, 
  price1: number, 
  price2: number,
  pair: string
): boolean {
  // Check if prices are valid
  if (!validatePriceData(price1, `${pair}-Exchange1`) || !validatePriceData(price2, `${pair}-Exchange2`)) {
    return false;
  }
  
  // Check for unrealistic profit margins (likely indicates bad data)
  if (profitPercentage > 50) { // More than 50% profit is suspicious
    console.warn(`[Validation] Unrealistic profit margin: ${profitPercentage}% for ${pair}`);
    return false;
  }
  
  // Check for unrealistic absolute profit
  if (profit > 10000) { // More than $10,000 profit is suspicious
    console.warn(`[Validation] Unrealistic profit amount: $${profit} for ${pair}`);
    return false;
  }
  
  // Check if price difference makes sense
  const priceDiff = Math.abs(price1 - price2);
  const avgPrice = (price1 + price2) / 2;
  const diffPercentage = (priceDiff / avgPrice) * 100;
  
  if (diffPercentage > 20) { // More than 20% price difference is suspicious
    console.warn(`[Validation] Unrealistic price difference: ${diffPercentage}% between exchanges for ${pair}`);
    return false;
  }
  
  console.log(`[Validation] ✓ Arbitrage opportunity validated: ${profitPercentage}% profit, $${profit} for ${pair}`);
  return true;
}
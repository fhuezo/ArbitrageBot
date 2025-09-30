export function bpsToDecimal(bps: number): number {
  return bps / 10_000;
}

export function applySlippage(amount: bigint, slippageBps: number, direction: 'in' | 'out'): bigint {
  const s = BigInt(slippageBps);
  const base = 10_000n;
  if (direction === 'in') {
    return (amount * (base + s)) / base; // tolerate up to +slippage on input
  }
  return (amount * (base - s)) / base; // expect at least -slippage on output
}

// x*y = k model with fee. feeBps applies to input.
export function constantProductOutAmount(
  inAmount: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number
): bigint {
  if (inAmount <= 0n) return 0n;
  const fee = BigInt(feeBps);
  const base = 10_000n;
  const inAfterFee = (inAmount * (base - fee)) / base;
  const numerator = inAfterFee * reserveOut;
  const denominator = reserveIn + inAfterFee;
  return numerator / denominator;
}

export function toUi(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

export function fromUi(amount: number, decimals: number): bigint {
  return BigInt(Math.floor(amount * 10 ** decimals));
}


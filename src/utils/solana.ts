import { Connection, Keypair, PublicKey, VersionedTransaction, Commitment } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import { config } from '../config.js';

export function getConnection(): Connection {
  return new Connection(config.rpcUrl, { commitment: 'confirmed' as Commitment });
}

export function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, 'utf-8')) as number[];
  const kp = Keypair.fromSecretKey(Uint8Array.from(raw));
  return kp;
}

export async function sendVtx(
  connection: Connection,
  tx: VersionedTransaction,
  signers: Keypair[]
): Promise<string> {
  tx.sign(signers);
  const sig = await connection.sendTransaction(tx, {
    skipPreflight: true,
    maxRetries: 3,
    preflightCommitment: 'processed',
  });
  return sig;
}

export async function waitForFinality(connection: Connection, sig: string): Promise<void> {
  await connection.confirmTransaction(sig, 'confirmed');
}

export function pk(s: string): PublicKey {
  return new PublicKey(s);
}



export function loadKeypairFromEnv(): Keypair | null {
  const raw = (process.env.SOLANA_PRIVATE_KEY || '').trim();
  if (!raw) return null;
  try {
    if (raw.startsWith('[')) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return Keypair.fromSecretKey(Uint8Array.from(arr.map((x: any) => Number(x))));
    }
    if (raw.includes(',')) {
      const parts = raw.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
      if (parts.length >= 64) return Keypair.fromSecretKey(Uint8Array.from(parts));
    }
    const decoded = bs58.decode(raw);
    if (decoded && decoded.length >= 64) return Keypair.fromSecretKey(decoded);
  } catch (e) {
    console.warn('[wallet] Failed to parse SOLANA_PRIVATE_KEY:', e);
  }
  return null;
}

export function getDefaultKeypair(): Keypair {
  const envKp = loadKeypairFromEnv();
  if (envKp) return envKp;
  return loadKeypair(config.walletPath);
}

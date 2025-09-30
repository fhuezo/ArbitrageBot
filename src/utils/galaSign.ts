import { keccak256 } from 'ethereum-cryptography/keccak';
import * as secp from '@noble/secp256k1';
import { utils as secpUtils } from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { concatBytes } from '@noble/hashes/utils';

type AnyObj = Record<string, any>;

function strip0x(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

export function normalizePrivateKey(hexKey: string): Uint8Array {
  const hex = strip0x(hexKey.trim());
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== 64) {
    throw new Error('Invalid private key hex (expected 32 bytes)');
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function removeSigTrace(obj: any): any {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const out: AnyObj = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'signature' || k === 'trace') continue;
      out[k] = v;
    }
    return out;
  }
  return obj;
}

export function deterministicJson(payload: any): string {
  const cleaned = removeSigTrace(payload);
  return JSON.stringify(cleaned, Object.keys(cleaned).sort(), 0).replace(/\s+/g, '');
}

export function originalJson(payload: any): string {
  const cleaned = removeSigTrace(payload);
  return JSON.stringify(cleaned).replace(/\s+/g, '');
}

export function getEthAddress(privHex: string): string {
  const priv = normalizePrivateKey(privHex);
  const pub = secp.getPublicKey(priv, false); // uncompressed, 65 bytes
  const pubNoPrefix = pub.slice(1); // drop 0x04
  const hash = keccak256(pubNoPrefix);
  const addrHex = Buffer.from(hash.slice(-20)).toString('hex');
  return '0x' + addrHex;
}

// Wire HMAC-SHA256 for noble-secp256k1 if not already set (avoid reassigning module namespace)
{
  const u: any = secpUtils as any;
  if (!u.hmacSha256Sync) {
    u.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) =>
      hmac(sha256, key, concatBytes(...msgs));
  }
  if (!u.hmacSha256) {
    u.hmacSha256 = async (key: Uint8Array, ...msgs: Uint8Array[]) =>
      hmac(sha256, key, concatBytes(...msgs));
  }
}

export async function getSignatureAsync(opts: {
  payload: any;
  privateKeyHex: string;
  vMode?: 'eth' | 'raw';
  signMode?: 'hash' | 'eip191';
  order?: 'sorted' | 'original';
  hexPrefix?: boolean;
}): Promise<string> {
  const { payload, privateKeyHex, vMode = 'eth', signMode = 'hash', order = 'sorted', hexPrefix = false } = opts;

  // Serialize message
  const messageStr = order === 'sorted' ? deterministicJson(payload) : originalJson(payload);
  const messageBytes = new TextEncoder().encode(messageStr);

  // Hash (keccak) or EIP-191 prefixed keccak
  let digest: Uint8Array;
  if (signMode === 'eip191') {
    const prefix = new TextEncoder().encode(`\u0019Ethereum Signed Message:\n${messageBytes.length}`);
    const prefixed = new Uint8Array(prefix.length + messageBytes.length);
    prefixed.set(prefix, 0);
    prefixed.set(messageBytes, prefix.length);
    digest = keccak256(prefixed);
  } else {
    digest = keccak256(messageBytes);
  }

  // Sign WITHOUT any options (avoid env-specific option issues)
  const sk = normalizePrivateKey(privateKeyHex);
  const sigCompact: Uint8Array = await (secp as any).sign(digest, sk);

  // Derive recovery id by recovering pubkeys and comparing
  const expectedPub = (secp.getPublicKey(sk, false) as Uint8Array).slice(1);
  let recid = 0;
  try {
    for (let i = 0; i < 2; i++) {
      const rec = (secp as any).recoverPublicKey(digest, sigCompact, i, false) as Uint8Array | undefined;
      if (rec) {
        const recNoPrefix = rec.slice(1);
        if (Buffer.compare(Buffer.from(recNoPrefix), Buffer.from(expectedPub)) === 0) { recid = i; break; }
      }
    }
  } catch {
    recid = 0;
  }

  const r = sigCompact.slice(0, 32);
  const s = sigCompact.slice(32, 64);
  const v = vMode === 'eth' ? 27 + recid : recid;
  const sig = Buffer.concat([Buffer.from(r), Buffer.from(s), Buffer.from([v])]);
  const hex = sig.toString('hex');
  return hexPrefix ? '0x' + hex : hex;
}



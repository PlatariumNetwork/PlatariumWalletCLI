/**
 * Platarium cryptographic primitives - aligned with PlatariumCore (Rust).
 */
import { HDKey } from '@scure/bip32';
import {
  entropyToMnemonic,
  mnemonicToSeedSync,
  validateMnemonic as bip39Validate,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import * as secp256k1 from '@noble/secp256k1';

secp256k1.etc.hmacSha256Sync = (key, ...msgs) =>
  hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));

export const CHARACTER_SET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const DOMAIN_SEPARATOR = 'PlatariumSignature:';

const HKDF_SALT_SIG_KEY = new TextEncoder().encode('PlatariumSignatureKeySalt2050');
const HKDF_INFO_SIG_KEY = new TextEncoder().encode('Signature Key Derivation');
/** Rust `hkdf`: salt `None` → HashLen zero salt (SHA-256 → 32 bytes). */
const HKDF_EMPTY_SALT = new Uint8Array(32);

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomAlphanumeric(length, rng = (buf) => crypto.getRandomValues(buf)) {
  const chars = CHARACTER_SET;
  const out = [];
  const buf = new Uint8Array(length);
  rng(buf);
  for (let i = 0; i < length; i++) out.push(chars[buf[i] % chars.length]);
  return out.join('');
}

export function generateMnemonicPair() {
  const entropy = new Uint8Array(32);
  crypto.getRandomValues(entropy);
  const mnemonic = entropyToMnemonic(entropy, wordlist);
  const alphanumeric = randomAlphanumeric(12);
  return { mnemonic, alphanumeric };
}

export function validateMnemonicPhrase(mnemonic) {
  return bip39Validate(mnemonic, wordlist);
}

function bnToHex32(bytes) {
  return bytesToHex(bytes).padStart(64, '0');
}

function deriveSignatureSeedFromMasterSeed(masterSeed) {
  return hkdf(sha256, masterSeed, HKDF_SALT_SIG_KEY, HKDF_INFO_SIG_KEY, 32);
}

export function deriveKeyPair(mnemonic, alphanumeric, seedIndex = 0, customPath) {
  if (!validateMnemonicPhrase(mnemonic)) {
    throw new Error('Invalid BIP39 mnemonic');
  }
  const masterSeed = Uint8Array.from(mnemonicToSeedSync(mnemonic, alphanumeric));
  const path = customPath || `m/44'/60'/0'/0/${seedIndex}`;

  const root = HDKey.fromMasterSeed(masterSeed);
  const mainNode = root.derive(path);
  if (!mainNode.privateKey) throw new Error('Failed to derive main private key');

  const mainPriv = mainNode.privateKey;
  const pubCompressed = secp256k1.getPublicKey(mainPriv, true);
  const publicKey = `Px${bytesToHex(pubCompressed)}`;
  const privateKey = `PSx${bnToHex32(mainPriv)}`;

  const sigSeed = deriveSignatureSeedFromMasterSeed(masterSeed);
  const signatureKey = `Sx${bnToHex32(sigSeed)}`;

  return {
    mnemonic,
    alphanumericPart: alphanumeric,
    derivationPaths: {
      mainPath: path,
      signaturePath: 'HKDF-derived',
    },
    publicKey,
    privateKey,
    signatureKey,
  };
}

function deriveHkdfSigningKey(seed, infoUtf8) {
  const info = new TextEncoder().encode(infoUtf8);
  return hkdf(sha256, seed, HKDF_EMPTY_SALT, info, 32);
}

/**
 * Matches `serde_json::to_string` on `serde_json::Value`: object keys sorted lexicographically.
 */
function canonicalJsonStringify(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid number');
    return JSON.stringify(value);
  }
  if (t === 'bigint') {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) throw new Error('BigInt too large for JSON hash');
    return JSON.stringify(n);
  }
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonStringify).join(',')}]`;
  }
  if (t === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(value[k])}`).join(',')}}`;
  }
  throw new Error(`Unsupported JSON value: ${t}`);
}

/** Hash for arbitrary JSON messages (`sign-message` CLI, legacy transfers). */
export function hashCanonicalPayload(messageObj) {
  const json = canonicalJsonStringify(messageObj);
  return sha256(new TextEncoder().encode(DOMAIN_SEPARATOR + json));
}

/** Hash for typed gateway tx (`TxHashData` struct field order in Rust). */
export function hashStructPayload(messageObj) {
  const json = JSON.stringify(messageObj);
  return sha256(new TextEncoder().encode(DOMAIN_SEPARATOR + json));
}

function dualSignDigest(digest, mnemonic, alphanumeric) {
  const seed = Uint8Array.from(mnemonicToSeedSync(mnemonic, alphanumeric));
  const mainPriv = deriveHkdfSigningKey(seed, `mainKey-${alphanumeric}`);
  const hkdfPriv = deriveHkdfSigningKey(seed, `hkdfKey-${alphanumeric}`);
  const mainSig = signDigest(digest, mainPriv);
  const hkdfSig = signDigest(digest, hkdfPriv);
  return {
    hash: bytesToHex(digest),
    signatures: [
      { sig_type: 'main', ...mainSig },
      { sig_type: 'hkdf', ...hkdfSig },
    ],
  };
}

/** Minimal ECDSA DER (supports low-S signatures from Platarium Core). */
function ecdsaDerFromCompact(compact64) {
  const r = compact64.subarray(0, 32);
  const s = compact64.subarray(32, 64);
  const stripLeadingZeros = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    return b.subarray(i);
  };
  let rb = stripLeadingZeros(r);
  let sb = stripLeadingZeros(s);
  if (rb[0] & 0x80) rb = new Uint8Array([0, ...rb]);
  if (sb[0] & 0x80) sb = new Uint8Array([0, ...sb]);
  const inner = new Uint8Array(2 + rb.length + 2 + sb.length);
  let o = 0;
  inner[o++] = 0x02;
  inner[o++] = rb.length;
  inner.set(rb, o);
  o += rb.length;
  inner[o++] = 0x02;
  inner[o++] = sb.length;
  inner.set(sb, o);
  const der = new Uint8Array(2 + inner.length);
  der[0] = 0x30;
  der[1] = inner.length;
  der.set(inner, 2);
  return bytesToHex(der);
}

export function signDigest(hash32, privateKey32) {
  const sig = secp256k1.sign(hash32, privateKey32);
  const compact = sig.toCompactRawBytes();
  const pub = secp256k1.getPublicKey(privateKey32, true);
  return {
    r: bytesToHex(compact.subarray(0, 32)).padStart(64, '0'),
    s: bytesToHex(compact.subarray(32, 64)).padStart(64, '0'),
    pub_key: bytesToHex(pub),
    der: ecdsaDerFromCompact(compact),
    signature_compact: `${bytesToHex(compact)}01`,
  };
}

export function signWithBothKeys(messageObj, mnemonic, alphanumeric) {
  if (!validateMnemonicPhrase(mnemonic)) {
    throw new Error('Invalid BIP39 mnemonic');
  }
  const digest = hashCanonicalPayload(messageObj);
  return dualSignDigest(digest, mnemonic, alphanumeric);
}

function hexToBytes(hex) {
  const h = hex.replace(/^0x/, '');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function verifySignature(messageObj, signatureHex, pubKeyHex) {
  const digest = hashCanonicalPayload(messageObj);
  let sigBytes = hexToBytes(signatureHex);
  if (sigBytes.length === 65 && sigBytes[64] === 1) {
    sigBytes = sigBytes.subarray(0, 64);
  }
  const pub = hexToBytes(pubKeyHex);
  return secp256k1.verify(sigBytes, digest, pub);
}

export function normalizeAsset(asset) {
  if (asset === 'PLP' || asset === undefined || asset === null) return 'PLP';
  const s = String(asset);
  if (s.startsWith('Token:')) return s;
  return `Token:${s}`;
}

export function signGatewayTransaction(
  { from, to, asset = 'PLP', amount, fee_uplp, nonce, reads = [], writes = [] },
  mnemonic,
  alphanumeric,
) {
  const canonical = normalizeAsset(asset);
  const readsSorted = [...reads].map(String).sort();
  const writesSorted = [...writes].map(String).sort();
  const amountNum = typeof amount === 'bigint' ? Number(amount) : Number(amount);
  const feeNum = typeof fee_uplp === 'bigint' ? Number(fee_uplp) : Number(fee_uplp);
  const message = {
    from,
    to,
    asset: canonical,
    amount: amountNum,
    fee_uplp: feeNum,
    nonce: Number(nonce),
    reads: readsSorted,
    writes: writesSorted,
  };
  if (!validateMnemonicPhrase(mnemonic)) {
    throw new Error('Invalid BIP39 mnemonic');
  }
  const digest = hashStructPayload(message);
  const sigResult = dualSignDigest(digest, mnemonic, alphanumeric);
  return {
    hash: sigResult.hash,
    from,
    to,
    asset: canonical,
    amount: amountNum,
    fee_uplp: feeNum,
    nonce: message.nonce,
    reads: [...reads].map(String),
    writes: [...writes].map(String),
    sig_main: sigResult.signatures[0].signature_compact,
    sig_derived: sigResult.signatures[1].signature_compact,
    pub_main: sigResult.signatures[0].pub_key,
    pub_derived: sigResult.signatures[1].pub_key,
    _dual: sigResult,
  };
}

export function signLegacyTransferMessage(tx, mnemonic, alphanumeric) {
  const message = {
    from: tx.from,
    to: tx.to,
    amount: String(tx.amount),
    nonce: tx.nonce ?? 1,
    timestamp: tx.timestamp ?? Date.now(),
    type: tx.type || 'transfer',
  };
  const result = signWithBothKeys(message, mnemonic, alphanumeric);
  return {
    ...tx,
    signature: result.signatures[0].signature_compact,
    from: tx.from,
    _dual: result,
  };
}

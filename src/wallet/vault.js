import { webcrypto } from 'crypto';

const crypto = webcrypto;

function bufToB64(buf) {
  return Buffer.from(buf).toString('base64');
}

function b64ToBuf(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function deriveKeyFromPassword(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 210_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJson(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKeyFromPassword(password, salt);
  const pt = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt);
  return {
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    data: bufToB64(new Uint8Array(ct)),
  };
}

export async function decryptJson(blob, password) {
  const salt = b64ToBuf(blob.salt);
  const iv = b64ToBuf(blob.iv);
  const data = b64ToBuf(blob.data);
  const key = await deriveKeyFromPassword(password, salt);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return JSON.parse(new TextDecoder().decode(pt));
}

// 共享密码 → PBKDF2-SHA256（60 万次）→ AES-256-GCM，加/解密子账号密钥。
// 浏览器和 Node 18+ 都提供 globalThis.crypto.subtle。

export const ITERATIONS = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64encode(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

export function b64decode(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export class WrongPasswordError extends Error {
  constructor() {
    super('密码不正确，请重试');
    this.code = 'WRONG_PASSWORD';
  }
}

/** extractable=false：用于“记住此设备”时存进 IndexedDB 的密钥无法被导出 */
export async function deriveKey(password, salt, iterations = ITERATIONS, extractable = false) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  );
}

export async function encryptSecret(payload, password, iterations = ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload)));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: iterations, salt: b64encode(salt), iv: b64encode(iv), ct: b64encode(ct) };
}

export async function keyFromPassword(blob, password) {
  return deriveKey(password, b64decode(blob.salt), blob.iter || ITERATIONS);
}

export async function decryptWithKey(blob, key) {
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(blob.iv) }, key, b64decode(blob.ct));
  } catch {
    throw new WrongPasswordError();
  }
  return JSON.parse(dec.decode(plain));
}

export async function decryptSecret(blob, password) {
  if (!blob || blob.v !== 1) throw new Error('密文格式不正确');
  const key = await keyFromPassword(blob, password);
  return { secret: await decryptWithKey(blob, key), key };
}

/** 密文指纹：更换密文后，已记住的设备会自动失效 */
export async function blobFingerprint(blob) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${blob.salt}|${blob.iv}|${blob.ct}`));
  return b64encode(digest).slice(0, 22);
}

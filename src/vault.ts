// Passwords are encrypted in the browser. The database stores only the ciphertext,
// and never sees the passphrase or the key. AES-GCM, key from PBKDF2-SHA-256.

const enc = new TextEncoder();
const dec = new TextDecoder();
const CHECK = "common-seal-vault-check";
export const ITERATIONS = 600_000;

const toB64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(atob(s).length));
  const bin = atob(s);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function derive(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encrypt(key: CryptoKey, text: string): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  return { iv: toB64(iv), ciphertext: toB64(ct) };
}
export async function decrypt(key: CryptoKey, iv: string, ciphertext: string): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(ciphertext));
  return dec.decode(pt);
}

/** A new vault: the salt and an encrypted check value, so a wrong passphrase can be told apart */
export async function newVault(passphrase: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(passphrase, salt, ITERATIONS);
  const check = await encrypt(key, CHECK);
  return { key, salt: toB64(salt), iv: check.iv, ciphertext: check.ciphertext, iterations: ITERATIONS };
}

/** Unlocks with the passphrase; throws if it is wrong */
export async function unlock(passphrase: string, v: { salt: string; check_iv: string; check_ciphertext: string; iterations: number }): Promise<CryptoKey> {
  const key = await derive(passphrase, fromB64(v.salt), v.iterations);
  let ok = false;
  try {
    ok = (await decrypt(key, v.check_iv, v.check_ciphertext)) === CHECK;
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("That passphrase is not right.");
  return key;
}

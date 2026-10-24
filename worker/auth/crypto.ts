import { b64url } from '../dns/wire';
const encoder = new TextEncoder();
export const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const left = await digest(a),
    right = await digest(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
export async function pinVerifier(pin: string, salt: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin + ':' + pepper),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100000 },
    key,
    256,
  );
  return b64url(new Uint8Array(bits));
}

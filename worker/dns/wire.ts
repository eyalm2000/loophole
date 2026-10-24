import { HttpError } from '../errors';

export const u16 = (bytes: Uint8Array, at: number): number => {
  if (at + 2 > bytes.length) throw new HttpError(400, 'Malformed DNS message.');
  return bytes[at] * 256 + bytes[at + 1];
};
export function dnsName(bytes: Uint8Array, at: number): { name: string; end: number } {
  const labels: string[] = [];
  let end = -1;
  const visited = new Set<number>();
  let size = 0;
  for (let steps = 0; steps < 128; steps++) {
    if (at >= bytes.length || visited.has(at)) throw new HttpError(400, 'Malformed DNS name.');
    visited.add(at);
    const length = bytes[at++];
    if (!length) return { name: labels.join('.').toLowerCase(), end: end < 0 ? at : end };
    if ((length & 0xc0) === 0xc0) {
      if (at >= bytes.length) throw new HttpError(400, 'Malformed DNS pointer.');
      if (end < 0) end = at + 1;
      at = ((length & 0x3f) << 8) | bytes[at];
      continue;
    }
    if (length > 63 || at + length > bytes.length || (size += length + 1) > 254)
      throw new HttpError(400, 'Malformed DNS name.');
    labels.push(Array.from(bytes.slice(at, at + length), (x) => String.fromCharCode(x)).join(''));
    at += length;
  }
  throw new HttpError(400, 'Too many DNS pointers.');
}
export function question(bytes: Uint8Array, response = false): { identity: string; end: number } {
  if (
    bytes.length < 17 ||
    bytes.length > 65535 ||
    Boolean(bytes[2] & 0x80) !== response ||
    (bytes[2] & 0x78) !== 0 ||
    u16(bytes, 4) !== 1
  )
    throw new HttpError(400, 'Expected a standard single-question DNS message.');
  const name = dnsName(bytes, 12);
  const type = u16(bytes, name.end),
    klass = u16(bytes, name.end + 2);
  return { identity: `${name.name}|${type}|${klass}`, end: name.end + 4 };
}
export function makeQuery(name: string, type = 1): Uint8Array<ArrayBuffer> {
  const labels = name.split('.');
  const bytes = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0];
  for (const label of labels) {
    bytes.push(label.length, ...new TextEncoder().encode(label));
  }
  bytes.push(0, type >> 8, type & 255, 0, 1);
  return Uint8Array.from(bytes);
}
export function validateRecords(bytes: Uint8Array, at: number): void {
  const records = u16(bytes, 6) + u16(bytes, 8) + u16(bytes, 10);
  for (let i = 0; i < records; i++) {
    at = dnsName(bytes, at).end;
    const size = u16(bytes, at + 8);
    at += 10 + size;
    if (at > bytes.length) throw new HttpError(400, 'Truncated DNS record.');
  }
  if (at !== bytes.length) throw new HttpError(400, 'Unexpected bytes after the DNS message.');
}
export function b64url(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (x) => String.fromCharCode(x)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

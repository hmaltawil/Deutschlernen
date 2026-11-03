/**
 * Sync codes: 24 random characters (120 bits) from an alphabet without look-alikes,
 * shown as six groups of four. The code itself never leaves the device; the
 * server only sees its SHA-256 hash, which names the sync space.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I, L, O, U)
const LENGTH = 24;

export function generateCode(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = rand(LENGTH);
  let s = '';
  for (let i = 0; i < LENGTH; i++) s += ALPHABET[bytes[i] & 31];
  return formatCode(s);
}

/** Uppercase, drop separators, map look-alikes (O→0, I/L→1). Returns '' if invalid. */
export function normalizeCode(input: string): string {
  const s = input
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (s.length !== LENGTH) return '';
  for (const ch of s) if (!ALPHABET.includes(ch)) return '';
  return s;
}

export function formatCode(code: string): string {
  const s = normalizeCode(code) || code;
  return s.match(/.{1,4}/g)!.join('-');
}

/** Hex SHA-256 of the normalized code: the document id used on the server. */
export async function syncIdFor(code: string): Promise<string> {
  const norm = normalizeCode(code);
  if (!norm) throw new Error('Invalid sync code');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`luecke-sync-v1:${norm}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

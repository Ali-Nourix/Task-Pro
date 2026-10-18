// Telegram's signed initData is the credential. Never trust initDataUnsafe.
import { equal } from './http.ts';
const encoder = new TextEncoder();
async function hmac(key: Uint8Array, value: string): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(value)));
}
export async function validateMiniAppData(raw: string, token: string, now: Date): Promise<number | null> {
  if (!token || !raw || raw.length > 8192) return null;
  try {
    const params = new URLSearchParams(raw), seen = new Set<string>();
    for (const [key] of params) { if (seen.has(key)) return null; seen.add(key); }
    const hash = params.get('hash') ?? '', timestamp = params.get('auth_date') ?? '';
    if (!/^[a-f0-9]{64}$/i.test(hash) || !/^\d{1,12}$/.test(timestamp)) return null;
    const age = now.getTime() / 1000 - Number(timestamp);
    if (age < -30 || age > 3600) return null;
    params.delete('hash');
    const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
    const secret = await hmac(encoder.encode('WebAppData'), token);
    const expected = [...await hmac(secret, check)].map(n => n.toString(16).padStart(2, '0')).join('');
    if (!equal(expected, hash.toLowerCase())) return null;
    const user = JSON.parse(params.get('user') ?? 'null');
    return user && Number.isSafeInteger(user.id) && user.id > 0 && user.is_bot !== true ? user.id : null;
  } catch { return null; }
}

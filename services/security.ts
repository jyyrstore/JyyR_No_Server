import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export function generateSecret(prefix: string) {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function privateIpv4(ip: string) {
  const p = ip.split('.').map(Number);
  return p.length === 4 && (p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168));
}

function privateIpv6(ip: string) {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
}

function privateIp(ip: string) {
  return isIP(ip) === 4 ? privateIpv4(ip) : isIP(ip) === 6 ? privateIpv6(ip) : true;
}

export async function isSafeWebhookUrl(value: string) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return false;
    if (u.username || u.password || !u.hostname || u.hostname.endsWith('.local') || u.hostname.endsWith('.internal')) return false;
    const addresses = await lookup(u.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => privateIp(entry.address))) return false;
    return true;
  } catch { return false; }
}

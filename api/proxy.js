import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_ASSET_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 4;

function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function ipv6Bytes(address) {
  let input = String(address || '').toLowerCase().split('%')[0];
  const v4 = input.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) {
    const octets = v4[1].split('.').map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    input = input.slice(0, -v4[1].length) + hi + ':' + lo;
  }

  const halves = input.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (left.some((x) => !/^[0-9a-f]{1,4}$/.test(x)) || right.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...right];
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const group of groups) {
    const value = parseInt(group, 16);
    bytes.push((value >> 8) & 255, value & 255);
  }
  return bytes;
}

function isPrivateIPv6(address) {
  const bytes = ipv6Bytes(address);
  if (!bytes) return true;
  const allZero = bytes.every((b) => b === 0);
  const loopback = bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1;
  if (allZero || loopback) return true;

  const mappedV4 = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mappedV4) return isPrivateIPv4(bytes.slice(12).join('.'));

  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true; // multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // documentation

  // Normal public IPv6 web traffic is global-unicast 2000::/3.
  return (bytes[0] & 0xe0) !== 0x20;
}

function isPrivateAddress(address) {
  const kind = isIP(address);
  if (kind === 4) return isPrivateIPv4(address);
  if (kind === 6) return isPrivateIPv6(address);
  return true;
}

function isObviouslyPrivateHost(hostname) {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '::1' || h.endsWith('.local')) return true;
  return isIP(h) ? isPrivateAddress(h) : false;
}

function validateUrl(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('Missing URL.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs are supported.');
  if (url.username || url.password) throw new Error('Credential-bearing URLs are not allowed.');
  if (isObviouslyPrivateHost(url.hostname)) throw new Error('Private/local network URLs are not allowed.');
  return url;
}

async function assertPublicDns(hostname) {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('Private/local network URLs are not allowed.');
    return;
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Could not resolve target hostname.');
  }
  if (!addresses.length) throw new Error('Could not resolve target hostname.');
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Target hostname resolves to a private/local network address.');
  }
}

async function fetchWithSafeRedirects(initialUrl) {
  let url = validateUrl(initialUrl);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertPublicDns(url.hostname);
    const response = await fetch(url, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; FigmaBridge/0.1; +https://neustackstudio.com)',
        accept: 'text/html,application/xhtml+xml,image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    url = validateUrl(new URL(location, url).href);
  }
  throw new Error('Too many redirects.');
}

async function readLimited(response, maxBytes) {
  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > maxBytes) throw new Error(`Response exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only.' });

  try {
    const mode = req.query.mode === 'asset' ? 'asset' : 'html';
    const target = validateUrl(req.query.url);
    const response = await fetchWithSafeRedirects(target.href);
    if (!response.ok) throw new Error(`Origin returned HTTP ${response.status}.`);

    if (mode === 'asset') {
      const type = (response.headers.get('content-type') || '').toLowerCase();
      if (type && !type.startsWith('image/') && !type.startsWith('font/') && !type.includes('octet-stream')) {
        throw new Error(`Expected an image asset but received ${type.split(';')[0]}.`);
      }
      const bytes = await readLimited(response, MAX_ASSET_BYTES);
      res.setHeader('Content-Type', type || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
      return res.status(200).send(Buffer.from(bytes));
    }

    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (type && !type.includes('text/html') && !type.includes('application/xhtml+xml')) {
      throw new Error(`Expected HTML but received ${type.split(';')[0]}.`);
    }

    const bytes = await readLimited(response, MAX_HTML_BYTES);
    const html = new TextDecoder('utf-8').decode(bytes);
    return res.status(200).json({ html, finalUrl: response.url || target.href });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'Proxy request failed.' });
  }
}

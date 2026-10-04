const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_ASSET_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 4;

function isPrivateHost(hostname) {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h.endsWith('.local')) return true;

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  if ([0, 10, 127].includes(a)) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function validateUrl(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('Missing URL.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs are supported.');
  if (url.username || url.password) throw new Error('Credential-bearing URLs are not allowed.');
  if (isPrivateHost(url.hostname)) throw new Error('Private/local network URLs are not allowed.');
  return url;
}

async function fetchWithSafeRedirects(initialUrl) {
  let url = validateUrl(initialUrl);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Relay/0.1; +https://neustackstudio.com)',
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
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new Error(`Response exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
  return buffer;
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
      const bytes = await readLimited(response, MAX_ASSET_BYTES);
      const type = response.headers.get('content-type') || 'application/octet-stream';
      res.setHeader('Content-Type', type);
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

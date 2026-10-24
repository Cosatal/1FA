const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

// Request to an address given by a Discord server (its own AI behind a tunnel, e.g. Cloudflare Tunnel or ngrok).
// The bot runs on a VPS: anything leading to its private network is refused (localhost, 192.168.x, 10.x, cloud metadata…),
// including when a domain name points to a private address. https required, redirects are not followed.

const MAX_BYTES = 4 * 1024 * 1024;

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade shared network
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return v.includes('.') ? isPrivate(v.slice(7)) : true;
  return v === '::' || v === '::1' || /^(fc|fd|fe[89ab]|ff)/.test(v);
}

// DNS resolution checked at the very moment of connecting (the address can't change between the check and the call)
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((a) => isPrivate(a.address))) {
      return callback(Object.assign(new Error('adresse privée refusée'), { code: 'EPRIVATE' }));
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

// Returns { ok, status, json }
function publicRequest(url, { method = 'GET', headers = {}, body, timeout = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return reject(new Error('adresse invalide'));
    }
    if (target.protocol !== 'https:') return reject(new Error('l’adresse doit commencer par https://'));
    const host = target.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isPrivate(host)) return reject(Object.assign(new Error('adresse privée refusée'), { code: 'EPRIVATE' }));

    const payload = body ? Buffer.from(body) : null;
    const req = https.request(target, {
      method,
      headers: payload ? { ...headers, 'Content-Length': payload.length } : headers,
      lookup: safeLookup,
      timeout,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) req.destroy(new Error('réponse trop grande'));
        else chunks.push(chunk);
      });
      res.on('end', () => {
        let json = {};
        try {
          json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { publicRequest, isPrivate };

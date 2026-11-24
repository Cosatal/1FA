const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

// Request to an address given by a Discord server (its own AI behind a tunnel, e.g. Cloudflare Tunnel or ngrok).
// The bot runs on a VPS: anything leading to its private network is refused (localhost, 192.168.x, 10.x, cloud metadata…),
// including when a domain name points to a private address. https required (http only with the http option);
// redirects are not followed, unless asked (redirects option): each hop is checked again.

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
  // NAT64 (64:ff9b::) and 6to4 (2002::) can lead to any IPv4 address, private ones included
  return v === '::' || v === '::1' || /^(fc|fd|fe[89ab]|ff|64:ff9b:|2002:)/.test(v);
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

// Returns { ok, status, json, text }
function publicRequest(url, { method = 'GET', headers = {}, body, timeout = 300000, http: allowHttp = false, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return reject(new Error('adresse invalide'));
    }
    if (target.protocol !== 'https:' && !(allowHttp && target.protocol === 'http:')) return reject(new Error('l’adresse doit commencer par https://'));
    const host = target.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isPrivate(host)) return reject(Object.assign(new Error('adresse privée refusée'), { code: 'EPRIVATE' }));

    const payload = body ? Buffer.from(body) : null;
    const req = (target.protocol === 'http:' ? http : https).request(target, {
      method,
      headers: payload ? { ...headers, 'Content-Length': payload.length } : headers,
      lookup: safeLookup,
      timeout,
    }, (res) => {
      const location = res.headers.location;
      if (redirects > 0 && res.statusCode >= 300 && res.statusCode < 400 && location) {
        res.resume();
        const next = new URL(location, target).href;
        return resolve(publicRequest(next, { method, headers, body, timeout, http: allowHttp, redirects: redirects - 1 }));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) req.destroy(new Error('réponse trop grande'));
        else chunks.push(chunk);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = {};
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, text });
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

// Protections of the dashboard web server, without extra dependency:
//   securityHeaders: strict Content-Security-Policy (only the site's own scripts can run: a forgotten esc() can't
//     become an XSS), no framing of the site, no MIME sniffing, HTTPS kept by the browser once hosted.
//   sameOrigin: changes (POST, PUT, DELETE…) only accepted from the dashboard's own pages (CSRF).
//   rateLimit: a maximum number of requests per person and per minute, per group of routes.
const { every } = require('../core/scheduler');

function securityHeaders(baseUrl) {
  const https = baseUrl.startsWith('https://');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    // Inline styles are used by the pages (colors, positions); fonts come from Google Fonts
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // Avatars, server icons, images chosen for the embeds (any https address), drawn previews
    "img-src 'self' data: blob: https:",
    // The emoji list of the emoji picker
    "connect-src 'self' https://cdn.jsdelivr.net",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      ...(https && { 'Strict-Transport-Security': 'max-age=15552000' }),
    });
    next();
  };
}

// A browser always sends Origin with a POST / PUT / DELETE: one that comes from another site is refused
function sameOrigin(baseUrl) {
  const allowed = new URL(baseUrl).origin;
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (!origin || origin === allowed || origin === `${req.protocol}://${req.get('host')}`) return next();
    res.status(403).json({ error: 'Requête refusée (origine inconnue).' });
  };
}

// max requests per window (milliseconds), counted per logged-in person (otherwise per IP address)
function rateLimit({ max, windowMs = 60_000, name }) {
  const hits = new Map(); // key → { count, reset }
  every(`rate-limit-${name}`, windowMs, () => {
    for (const [key, h] of hits) if (h.reset < Date.now()) hits.delete(key);
  });
  return (req, res, next) => {
    const key = req.session?.user?.id ?? req.ip;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, (h = { count: 0, reset: now + windowMs }));
    h.count++;
    if (h.count <= max) return next();
    const wait = Math.ceil((h.reset - now) / 1000);
    res.set('Retry-After', String(wait));
    if (req.path.startsWith('/api/')) return res.status(429).json({ error: `Trop de requêtes (${name}) : réessaie dans ${wait} s.` });
    res.status(429).send(`Trop de requêtes : réessaie dans ${wait} secondes.`);
  };
}

module.exports = { securityHeaders, sameOrigin, rateLimit };

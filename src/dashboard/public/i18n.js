// French → English translation, shared by the bot (Node) and the web pages.
// Texts stay written in French in the code: the dictionary (i18n-en.js) gives their English version.
// A key can contain variables {0}, {name}… that match any text: "{0} a été banni" translates "Bob a été banni".
// A text missing from the dictionary stays in French.
(function (root) {
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const HAS_LETTERS = /[A-Za-zÀ-ÿ]{2}/;

  // whole: only whole texts are translated, never line by line (used for the default texts, see translatePayload)
  function createTranslator(dict, { whole = false } = {}) {
    const exact = new Map();
    const patterns = [];
    for (const [fr, en] of Object.entries(dict)) {
      const parts = fr.split(/\{(\w+)\}/);
      if (parts.length === 1) {
        exact.set(fr, en);
        continue;
      }
      const literals = parts.filter((_, i) => i % 2 === 0);
      patterns.push({
        re: new RegExp(`^${parts.map((p, i) => (i % 2 ? '([\\s\\S]*?)' : escapeRe(p))).join('')}$`),
        names: parts.filter((_, i) => i % 2 === 1),
        hint: literals.reduce((a, b) => (b.length > a.length ? b : a), ''), // quick test before the regular expression
        size: literals.join('').length,
        en,
      });
    }
    // Most specific keys first
    patterns.sort((a, b) => b.size - a.size);

    const cache = new Map();
    // A whole text (without surrounding spaces), or null if it isn't in the dictionary
    function lookup(text) {
      if (exact.has(text)) return exact.get(text);
      for (const p of patterns) {
        if (!text.includes(p.hint)) continue;
        const m = p.re.exec(text);
        if (!m) continue;
        const values = {};
        // Variable parts are translated too if they are known (e.g. a date, a module name), spaces kept
        p.names.forEach((name, i) => {
          const part = m[i + 1];
          const core = part.trim();
          const done = core && core !== text && HAS_LETTERS.test(core) ? lookup(core) : null;
          values[name] = done === null ? part : part.replace(core, () => done);
        });
        return p.en.replace(/\{(\w+)\}/g, (all, name) => (name in values ? values[name] : all));
      }
      return null;
    }

    function translateCore(text) {
      const core = text.trim();
      if (!core || !HAS_LETTERS.test(core)) return text;
      const found = lookup(core) ?? (/\s{2,}|\n/.test(core) ? lookup(core.replace(/\s+/g, ' ')) : null);
      if (found !== null) return text.replace(core, () => found);
      // Multi-line message: each line separately
      if (!whole && core.includes('\n')) return text.replace(core, () => core.split('\n').map((line) => translateCore(line)).join('\n'));
      // Parts separated by " · " (e.g. "🟢 En ligne · 3 joueurs · RCON configuré"): each part separately
      if (!whole && core.includes(' · ')) return text.replace(core, () => core.split(' · ').map((part) => translateCore(part)).join(' · '));
      return text;
    }

    return function translate(text) {
      if (typeof text !== 'string' || !HAS_LETTERS.test(text)) return text;
      if (cache.has(text)) return cache.get(text);
      const result = translateCore(text);
      if (cache.size > 5000) cache.clear();
      cache.set(text, result);
      return result;
    };
  }

  // Invisible character at the start of a text that must never be translated (texts written in the dashboard, AI or staff replies…):
  // removed before sending. At the start of a message's content: the whole message is kept as is
  const KEEP = '⁣';
  // Marks a text written by the server (dashboard): never translated. max = Discord's limit for this field (the marker counts)
  const keep = (text, max = Infinity) => (typeof text === 'string' && text ? KEEP + text.slice(0, max - 1) : text);

  // Discord message (content, embeds, components, modal): translated in place.
  // kept: applied to the texts marked KEEP. Admins' own texts are never translated, but the bot's default texts
  // (default ticket message, welcome message… still unchanged) follow the server language: see DEFAULTS in i18n-en.js
  function translatePayload(body, translator, kept = (text) => text) {
    if (!body || typeof body !== 'object') return body;
    if (body.data && typeof body.data === 'object' && 'type' in body) translatePayload(body.data, translator, kept); // reply to an interaction
    // Content marked KEEP: the whole message stays as is (only the markers are removed)
    let base = translator;
    if (typeof body.content === 'string' && body.content.startsWith(KEEP)) {
      body.content = kept(body.content.slice(KEEP.length));
      base = kept;
    }
    // Text marked KEEP: kept as is, without the marker
    const t = (text) => (typeof text === 'string' && text.startsWith(KEEP) ? kept(text.slice(KEEP.length)) : base(text));
    if (typeof body.content === 'string') body.content = t(body.content);
    if (typeof body.title === 'string') body.title = t(body.title); // modal
    for (const e of body.embeds ?? []) {
      for (const key of ['title', 'description']) if (e[key]) e[key] = t(e[key]);
      if (e.author?.name) e.author.name = t(e.author.name);
      if (e.footer?.text) e.footer.text = t(e.footer.text);
      for (const f of e.fields ?? []) {
        f.name = t(f.name);
        f.value = t(f.value);
      }
    }
    const components = (list) => {
      for (const c of list ?? []) {
        if (!c || typeof c !== 'object') continue;
        for (const key of ['label', 'placeholder', 'content', 'description']) if (typeof c[key] === 'string') c[key] = t(c[key]);
        for (const o of c.options ?? []) {
          o.label = t(o.label);
          if (o.description) o.description = t(o.description);
        }
        components(c.components);
        if (c.accessory) components([c.accessory]);
        if (c.component) components([c.component]);
      }
    };
    components(body.components);
    return body;
  }

  const api = { createTranslator, translatePayload, KEEP, keep };
  if (typeof module !== 'undefined') module.exports = api;
  else root.I18N = api;
})(typeof window !== 'undefined' ? window : globalThis);

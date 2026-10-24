// Language of the web pages (dashboard, staff panel, leaderboard): English by default, French can be chosen
// in the top bar (the choice is kept in the browser).
// In English, every displayed text is translated automatically, even those added later by scripts.
(() => {
  let saved = null;
  try {
    saved = localStorage.getItem('lang');
  } catch {}
  const lang = saved === 'fr' ? 'fr' : 'en';
  window.LANG = lang;
  document.documentElement.lang = lang;

  window.setLang = (value) => {
    try {
      localStorage.setItem('lang', value);
    } catch {}
    location.reload();
  };

  // Language switcher (#lang-switch element in the top bar)
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('lang-switch');
    if (!select) return;
    select.value = lang;
    select.addEventListener('change', () => window.setLang(select.value));
  });

  if (lang === 'fr') {
    window.tr = (text) => text;
    return;
  }

  const t = I18N.createTranslator(window.I18N_EN);
  window.tr = t;

  // Fields showing one of the bot's default texts (ticket message, welcome message…): shown in English.
  // Texts written by the admins are never changed. Saving the field as is keeps the default text,
  // which the bot sends in the server language.
  const defaults = I18N.createTranslator(window.I18N_EN.DEFAULTS, { whole: true });
  for (const proto of [HTMLInputElement.prototype, HTMLTextAreaElement.prototype]) {
    const { get, set } = Object.getOwnPropertyDescriptor(proto, 'value');
    Object.defineProperty(proto, 'value', {
      configurable: true,
      get() {
        return get.call(this);
      },
      set(value) {
        set.call(this, typeof value === 'string' ? defaults(value) : value);
      },
    });
  }
  // Fields created from HTML (value="…" or <textarea>…</textarea>) don't go through the setter
  const translateFields = (root) => {
    const fields = root.matches?.('input, textarea') ? [root] : [...(root.querySelectorAll?.('input, textarea') ?? [])];
    for (const field of fields) {
      const value = field.tagName === 'TEXTAREA' ? field.defaultValue : field.getAttribute('value');
      if (value && field.value === value) field.value = value;
    }
  };

  // Neither input fields nor areas marked translate="no" (members' messages, names…)
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
  const skipped = (el) => !el || SKIP.has(el.tagName) || el.closest?.('[translate="no"], [contenteditable="true"]');
  const ATTRS = ['placeholder', 'title', 'aria-label'];

  function translateNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (skipped(node.parentElement)) return;
      const next = t(node.data);
      if (next !== node.data) node.data = next;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    translateFields(node);
    if (skipped(node)) return;
    translateAttrs(node);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.ELEMENT_NODE) translateAttrs(n);
      else if (!skipped(n.parentElement)) {
        const next = t(n.data);
        if (next !== n.data) n.data = next;
      }
    }
  }

  function translateAttrs(el) {
    if (skipped(el)) return;
    for (const name of ATTRS) {
      const value = el.getAttribute(name);
      if (!value) continue;
      const next = t(value);
      if (next !== value) el.setAttribute(name, next);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'characterData') translateNode(m.target);
      else if (m.type === 'attributes') translateAttrs(m.target);
      else m.addedNodes.forEach(translateNode);
    }
  });

  const start = () => {
    document.title = t(document.title);
    translateNode(document.body);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);

  // Confirmation dialogs and alerts
  const confirm0 = window.confirm.bind(window);
  const alert0 = window.alert.bind(window);
  window.confirm = (message) => confirm0(t(message));
  window.alert = (message) => alert0(t(message));
})();

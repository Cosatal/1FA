// Dashboard appearance: dark / light / auto (the device's) theme, kept in this browser. The accent color is always
// the 1FA red (--accent in style.css). Loaded in <head> to apply the theme before rendering (no flash);
// the 🎨 menu is added next to the language switcher.
(() => {
  const read = (key, fallback) => {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  };
  const root = document.documentElement;
  const media = matchMedia('(prefers-color-scheme: light)');
  let mode = read('1fa-theme', 'dark');

  function apply() {
    root.dataset.theme = mode === 'auto' ? (media.matches ? 'light' : 'dark') : mode;
  }
  apply();
  media.addEventListener?.('change', () => mode === 'auto' && apply());

  function buildMenu() {
    const anchor = document.getElementById('lang-switch');
    if (!anchor || document.querySelector('.theme-menu')) return;
    const menu = document.createElement('span');
    menu.className = 'theme-menu';
    menu.innerHTML = `<button type="button" class="theme-btn" title="Apparence">🎨</button>
      <div class="theme-pop">
        <div class="theme-label">Thème</div>
        <div class="segmented theme-modes">
          <button type="button" data-mode="dark">🌙 Sombre</button><button type="button" data-mode="light">☀️ Clair</button><button type="button" data-mode="auto">💻 Auto</button>
        </div>
      </div>`;
    anchor.after(menu);

    const sync = () => menu.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    sync();

    menu.querySelector('.theme-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    menu.querySelector('.theme-pop').addEventListener('click', (e) => {
      const modeBtn = e.target.closest('[data-mode]');
      if (!modeBtn) return;
      mode = modeBtn.dataset.mode;
      write('1fa-theme', mode);
      apply();
      sync();
    });
    document.addEventListener('click', (e) => !menu.contains(e.target) && menu.classList.remove('open'));
    document.addEventListener('keydown', (e) => e.key === 'Escape' && menu.classList.remove('open'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildMenu);
  else buildMenu();
})();

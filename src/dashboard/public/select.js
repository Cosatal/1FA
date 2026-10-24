// Nicer dropdowns: search, # / 🔊 / 📁 icon for channels, colored dot and name for roles.
// The original <select> stays hidden inside the widget and keeps the value: existing code (value, change, innerHTML) works as is.
(() => {
  const SKIP = '#lang-switch, #bot-lang, .guild-select, [multiple], .inline select, [data-native]';
  const SEARCH_FROM = 8; // the search box only appears from this number of options
  const proto = {
    value: Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value'),
    selectedIndex: Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex'),
  };
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const roleColor = (id) => {
    // state is declared by app.js (global const: not visible through window)
    const color = (typeof state === 'undefined' ? null : state)?.data?.roles?.find((r) => r.id === id)?.color;
    return /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : null;
  };
  let openBox = null;
  const closeOpen = () => openBox?.close();

  // What an option shows: icon, text, color (from the prefix set by the scripts: "#", "🔊", "📁", "@")
  function describe(option) {
    const text = option.textContent.trim();
    if (!option.value) return { kind: 'none', label: text };
    let m;
    if ((m = text.match(/^#\s?(.*)$/))) return { kind: 'channel', icon: '#', label: m[1] };
    if ((m = text.match(/^🔊\s?(.*)$/u))) return { kind: 'voice', icon: '🔊', label: m[1] };
    if ((m = text.match(/^📁\s?(.*)$/u))) return { kind: 'category', icon: '📁', label: m[1] };
    if ((m = text.match(/^@(.*)$/))) return { kind: 'role', label: m[1], color: roleColor(option.value) };
    return { kind: 'plain', label: text };
  }

  function itemHtml(d) {
    if (d.kind === 'role') {
      const style = d.color ? ` style="--rc:${d.color}"` : '';
      return `<span class="sel-dot"${d.color ? ` style="background:${d.color}"` : ''}></span><span class="sel-text sel-role"${style}>@${esc(d.label)}</span>`;
    }
    return `${d.icon ? `<span class="sel-ico">${d.icon}</span>` : ''}<span class="sel-text">${esc(d.label)}</span>`;
  }

  function enhance(select) {
    if (select.dataset.sel || select.matches(SKIP)) return;
    select.dataset.sel = '1';
    const box = document.createElement('div');
    box.className = `sel${select.closest('.chips') ? ' sel-small' : ''}`;
    box.innerHTML = `<button type="button" class="sel-btn"><span class="sel-current"></span><span class="sel-arrow">▾</span></button>
      <div class="sel-pop"><input class="sel-search" type="text" autocomplete="off" spellcheck="false" placeholder="Rechercher…">
      <div class="sel-list" tabindex="-1"></div><div class="sel-empty" hidden>Aucun résultat</div></div>`;
    select.before(box);
    box.append(select);
    select.tabIndex = -1;
    const btn = box.querySelector('.sel-btn');
    const current = box.querySelector('.sel-current');
    const pop = box.querySelector('.sel-pop');
    const search = box.querySelector('.sel-search');
    const list = box.querySelector('.sel-list');
    const empty = box.querySelector('.sel-empty');
    let items = [];
    let active = -1;

    const highlight = () => {
      [...list.children].forEach((el, i) => el.classList.toggle('active', i === active));
      list.children[active]?.scrollIntoView({ block: 'nearest' });
    };

    const renderList = () => {
      const q = norm(search.value.trim());
      items = [...select.options].filter((o) => !o.hidden && (!q || norm(o.textContent).includes(q)));
      list.innerHTML = items
        .map((o, i) => `<div class="sel-opt${o.selected ? ' selected' : ''}${o.value ? '' : ' none'}" data-i="${i}">${itemHtml(describe(o))}${o.selected && o.value ? '<span class="sel-check">✓</span>' : ''}</div>`)
        .join('');
      empty.hidden = items.length > 0;
      active = q ? 0 : Math.max(0, items.findIndex((o) => o.selected));
      highlight();
    };

    const refresh = () => {
      const opt = select.selectedOptions[0] ?? select.options[0];
      current.innerHTML = opt ? itemHtml(describe(opt)) : '';
      current.classList.toggle('placeholder', !opt?.value);
      btn.disabled = select.disabled;
      if (openBox === box) renderList();
    };

    box.close = () => {
      box.classList.remove('open', 'up');
      if (openBox === box) openBox = null;
    };
    const open = () => {
      if (btn.disabled) return;
      closeOpen();
      openBox = box;
      search.value = '';
      search.hidden = select.options.length < SEARCH_FROM;
      renderList();
      // No room below: the list opens upwards
      const r = btn.getBoundingClientRect();
      box.classList.toggle('up', innerHeight - r.bottom < 320 && r.top > innerHeight - r.bottom);
      box.classList.add('open');
      (search.hidden ? list : search).focus({ preventScroll: true });
    };
    const choose = (option) => {
      if (!option) return;
      const changed = !option.selected;
      option.selected = true;
      box.close();
      refresh();
      btn.focus({ preventScroll: true });
      if (changed) {
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };

    // Existing code changes the value with select.value = …: the display follows
    for (const key of ['value', 'selectedIndex']) {
      Object.defineProperty(select, key, {
        configurable: true,
        get: () => proto[key].get.call(select),
        set: (v) => {
          proto[key].set.call(select, v);
          refresh();
        },
      });
    }
    new MutationObserver(refresh).observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });

    btn.addEventListener('click', () => (openBox === box ? box.close() : open()));
    pop.addEventListener('click', (e) => {
      e.preventDefault(); // no click forwarded to the button by the parent <label>
      const opt = e.target.closest('.sel-opt');
      if (opt) choose(items[opt.dataset.i]);
    });
    list.addEventListener('mousemove', (e) => {
      const opt = e.target.closest('.sel-opt');
      if (opt && Number(opt.dataset.i) !== active) {
        active = Number(opt.dataset.i);
        [...list.children].forEach((el, i) => el.classList.toggle('active', i === active));
      }
    });
    search.addEventListener('input', renderList);
    box.addEventListener('keydown', (e) => {
      if (openBox !== box) {
        if (e.target === btn && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          open();
        }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = Math.min(items.length - 1, Math.max(0, active + (e.key === 'ArrowDown' ? 1 : -1)));
        highlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choose(items[active]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        box.close();
        btn.focus();
      } else if (e.key === 'Tab') box.close();
    });

    refresh();
  }

  document.addEventListener('click', (e) => openBox && !openBox.contains(e.target) && closeOpen());

  const scan = (root) => root.querySelectorAll?.('select').forEach(enhance);
  scan(document);
  new MutationObserver((mutations) => {
    for (const m of mutations) m.addedNodes.forEach((node) => node.nodeType === 1 && (node.matches('select') ? enhance(node) : scan(node)));
  }).observe(document.body, { childList: true, subtree: true });
})();

// Emoji picker: clicking in an emoji field (input.emoji or [data-emoji]) opens a palette with a French search,
// categories, recently used emojis and the server's custom emojis. An emoji can always be pasted by hand.
// Emoji list: emojibase (French names), loaded only once on first opening.
(() => {
  // Emoji names in the site's language (lang.js sets the language on <html lang>)
  const DATA_URL = `https://cdn.jsdelivr.net/npm/emojibase-data@15.3.0/${document.documentElement.lang === 'en' ? 'en' : 'fr'}/compact.json`;
  const GROUPS = [
    ['recent', '🕘', 'Récents'], ['server', '🏠', 'Serveur'],
    [0, '😀', 'Smileys'], [1, '👋', 'Personnes'], [3, '🐶', 'Animaux et nature'], [4, '🍔', 'Nourriture'],
    [5, '✈️', 'Voyages et lieux'], [6, '⚽', 'Activités'], [7, '💡', 'Objets'], [8, '❤️', 'Symboles'], [9, '🏁', 'Drapeaux'],
  ];
  // If the full list can't be loaded: the most common ones
  const FALLBACK = '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😎 🤓 🧐 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 👽 👾 🤖 🎃 👍 👎 👏 🙌 🙏 🤝 💪 👋 ✌️ 🤞 👌 👀 🧠 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ✅ ❌ ⚠️ ❓ ❗ 💯 🔥 ⭐ 🌟 ✨ ⚡ 🎉 🎊 🎁 🏆 🥇 🎮 🎲 🎵 🎧 📢 📣 📌 📎 🔔 🔒 🔓 🛡️ ⚔️ 💡 📊 📈 📝 📅 ⏰ 💬 💭 📬 📩 🎫 🔗 🌍 🚀'
    .split(' ')
    .map((unicode) => ({ unicode, label: '', tags: [], group: 0 }));

  const t = (text) => (window.tr ? window.tr(text) : text);
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let emojis = null; // [{ unicode, label, tags, group, search }]
  let loading = null;
  let input = null; // current field
  let group = 'recent';

  function load() {
    loading ??= fetch(DATA_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => data.filter((e) => e.group !== undefined && e.group !== 2)) // without regional indicators or standalone skin tones
      .catch(() => FALLBACK)
      .then((list) => (emojis = list.map((e) => ({ ...e, search: norm(`${e.label} ${(e.tags ?? []).join(' ')}`) }))));
    return loading;
  }

  // Last picked emojis, kept in this browser
  const recentKey = '1fa-recent-emojis';
  const recents = () => {
    try {
      return JSON.parse(localStorage.getItem(recentKey)) ?? [];
    } catch {
      return [];
    }
  };
  const remember = (value) => {
    try {
      localStorage.setItem(recentKey, JSON.stringify([value, ...recents().filter((v) => v !== value)].slice(0, 32)));
    } catch {}
  };

  // Server's custom emojis (app.js: state.data.emojis)
  const serverEmojis = () =>
    (state?.data?.emojis ?? []).map((e) => ({ value: `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`, image: e.url, label: e.name, search: norm(e.name) }));

  // ---------- Palette ----------

  const pop = document.createElement('div');
  pop.className = 'emoji-pop';
  pop.hidden = true;
  // No automatic translation of the palette (hundreds of emoji names): its texts go through t()
  pop.setAttribute('translate', 'no');
  pop.innerHTML = `<input class="emoji-search" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(t('Rechercher un emoji…'))}">
    <div class="emoji-tabs">${GROUPS.map(([id, icon, name]) => `<button type="button" data-group="${id}" title="${esc(t(name))}">${icon}</button>`).join('')}</div>
    <div class="emoji-title"></div>
    <div class="emoji-grid"></div>`;
  document.body.append(pop);
  const search = $('.emoji-search', pop);
  const grid = $('.emoji-grid', pop);

  const cell = (e) =>
    e.image
      ? `<button type="button" class="emoji-cell" data-value="${esc(e.value)}" title=":${esc(e.label)}:"><img src="${esc(e.image)}" alt="" loading="lazy"></button>`
      : `<button type="button" class="emoji-cell" data-value="${esc(e.unicode)}" title="${esc(e.label)}">${e.unicode}</button>`;

  function render() {
    const q = norm(search.value.trim());
    let list;
    let title;
    if (q) {
      list = [...serverEmojis().filter((e) => e.search.includes(q)), ...(emojis ?? []).filter((e) => e.search.includes(q))].slice(0, 240);
      title = t('Résultats pour « {0} »').replace('{0}', search.value.trim());
    } else if (group === 'recent') {
      const custom = serverEmojis();
      list = recents().map((v) => custom.find((e) => e.value === v) ?? { unicode: v, label: '' });
      title = 'Récents';
    } else if (group === 'server') {
      list = serverEmojis();
      title = 'Emojis du serveur';
    } else {
      list = (emojis ?? []).filter((e) => e.group === group);
      title = GROUPS.find(([id]) => id === group)[2];
    }
    $$('.emoji-tabs button', pop).forEach((b) => b.classList.toggle('on', !q && String(group) === b.dataset.group));
    $('.emoji-title', pop).textContent = q ? title : t(title);
    const empty = !emojis && !q && typeof group === 'number' ? 'Chargement…' : group === 'recent' && !q ? 'Les emojis que tu choisis apparaîtront ici.' : group === 'server' && !q ? 'Ce serveur n’a pas d’emoji personnalisé.' : 'Aucun emoji trouvé.';
    grid.innerHTML = list.length ? list.map(cell).join('') : `<div class="emoji-empty">${esc(t(empty))}</div>`;
  }

  function place() {
    const r = input.getBoundingClientRect();
    const width = Math.min(352, innerWidth - 16);
    const below = innerHeight - r.bottom > 380 || r.top < 380;
    pop.style.width = `${width}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - width - 8)) + scrollX}px`;
    pop.style.top = below ? `${r.bottom + 6 + scrollY}px` : `${r.top - 6 - pop.offsetHeight + scrollY}px`;
  }

  function open(target) {
    input = target;
    search.value = '';
    // First choice: recent emojis if any, otherwise smileys
    if (group === 'recent' && !recents().length) group = 0;
    pop.hidden = false;
    render();
    place();
    load().then(() => !pop.hidden && (render(), place()));
  }
  const close = () => {
    pop.hidden = true;
    input = null;
  };

  function choose(value) {
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true })); // the forms save the value
    remember(value);
    const target = input;
    close();
    target.focus();
  }

  const isEmojiField = (el) => el?.matches?.('input.emoji, input[data-emoji]');
  document.addEventListener('focusin', (e) => {
    if (isEmojiField(e.target) && e.target !== input) open(e.target);
  });
  // New click in a field that already has focus (palette closed in the meantime)
  document.addEventListener('click', (e) => {
    if (isEmojiField(e.target) && pop.hidden) open(e.target);
  });
  document.addEventListener('pointerdown', (e) => {
    if (pop.hidden || pop.contains(e.target) || e.target === input) return;
    close();
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !pop.hidden && close());
  addEventListener('resize', () => !pop.hidden && place());

  pop.addEventListener('mousedown', (e) => e.target !== search && e.preventDefault()); // the field keeps focus
  pop.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-group]');
    if (tab) {
      group = /^\d+$/.test(tab.dataset.group) ? Number(tab.dataset.group) : tab.dataset.group;
      search.value = '';
      return render();
    }
    const emoji = e.target.closest('[data-value]');
    if (emoji) choose(emoji.dataset.value);
  });
  search.addEventListener('input', render);
})();

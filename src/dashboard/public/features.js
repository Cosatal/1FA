// Tabs of the schema-based modules (levels, custom commands, auto messages, temporary voice channels, counters,
// suggestions, starboard, birthdays, anti-raid, invites): the form is built from the schema sent by the bot.
// Relies on app.js and common.js ($, api, toast, esc, chips, state, renderHome).
(() => {
  const NAMES = ['levels', 'commands', 'autoMessages', 'tempVoice', 'counters', 'suggestions', 'starboard', 'birthdays', 'antiRaid', 'invites', 'aiTools', 'gameServers'];
  const forms = {}; // name → { guildId, schema, saved, draft, extra }

  // An empty panel per module, filled when the tab is opened
  const content = $('#view-guild .content');
  for (const name of NAMES) content.insertAdjacentHTML('beforeend', `<div id="tab-${name}" class="tab-panel hidden"></div>`);

  // ---------- Default values (same as on the bot side) ----------

  const EMPTY = { bool: false, int: 0, roles: [], channels: [], list: [], color: '#2f7ff0' };
  const defaultsOf = (fields) =>
    Object.fromEntries(fields.filter((f) => f.key).map((f) => [f.key, structuredClone(f.default ?? (f.type === 'select' ? f.options[0][0] : EMPTY[f.type] ?? ''))]));

  // ---------- Fields ----------

  const sources = {
    channel: () => state.data.channels.map((c) => ({ id: c.id, name: `# ${c.name}` })),
    voice: () => state.data.voiceChannels.map((c) => ({ id: c.id, name: `🔊 ${c.name}` })),
    category: () => state.data.categories.map((c) => ({ id: c.id, name: `📁 ${c.name}` })),
    role: (f) => state.data.roles.filter((r) => !f.assignable || r.editable).map((r) => ({ id: r.id, name: `@${r.name}` })),
  };

  function fieldEl(f, obj, onChange, rerender) {
    const el = document.createElement(f.type === 'list' || f.type === 'roles' || f.type === 'channels' ? 'div' : 'label');
    el.className = f.type === 'bool' ? 'check ff-check' : 'ff-field';
    if (f.when) el.dataset.when = JSON.stringify(f.when);
    const set = (value) => {
      obj[f.key] = value;
      onChange();
      refreshWhen();
    };

    if (f.type === 'bool') {
      const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: obj[f.key] === true });
      input.addEventListener('change', () => set(input.checked));
      el.append(input, ` ${f.label}`);
    } else if (f.type === 'list') {
      el.innerHTML = `<div class="ff-list-head"><strong>${esc(f.label)}</strong><span class="muted small">${obj[f.key].length}/${f.max}</span></div>`;
      obj[f.key].forEach((item, i) => {
        const box = document.createElement('div');
        box.className = 'ff-item';
        box.innerHTML = `<div class="ff-item-head"><span>${dragHandle}${esc(f.itemLabel)} ${i + 1}</span>
          <span class="item-actions"><button type="button" class="icon danger" data-del title="Supprimer">✕</button></span></div>`;
        box.querySelector('.ff-item-head').addEventListener('click', (e) => {
          if (e.target.dataset.del === undefined) return;
          obj[f.key].splice(i, 1);
          onChange();
          rerender();
        });
        buildFields(box, f.fields, item, onChange, rerender);
        el.append(box);
      });
      dragSort(el, (from, to) => {
        moveItem(obj[f.key], from, to);
        onChange();
        rerender();
      });
      const add = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost small', textContent: f.add ?? '+ Ajouter' });
      add.disabled = obj[f.key].length >= f.max;
      add.addEventListener('click', () => {
        obj[f.key].push(defaultsOf(f.fields));
        onChange();
        rerender();
      });
      el.append(add);
    } else {
      el.append(f.label);
      let input;
      if (f.type === 'roles' || f.type === 'channels') {
        input = document.createElement('div');
        input.className = 'chips';
        const items = f.type === 'roles' ? sources.role({}) : [...sources.channel(), ...sources.category()];
        chips(input, items, obj[f.key], '', onChange);
      } else if (f.type === 'textarea') {
        input = Object.assign(document.createElement('textarea'), { rows: 3, maxLength: f.max, value: obj[f.key] ?? '' });
        input.dataset.ai = f.ai ?? 'generic'; // "✨ Rédiger" button (ai-write.js)
        input.addEventListener('input', () => set(input.value));
      } else if (f.type === 'select' || sources[f.type]) {
        input = document.createElement('select');
        const options = f.type === 'select' ? f.options : [['', f.required ? 'Choisis…' : 'Aucun'], ...sources[f.type](f).map((i) => [i.id, i.name])];
        input.innerHTML = options.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
        // Value that no longer exists (deleted channel…): flagged instead of being silently lost
        if (obj[f.key] && !options.some(([v]) => v === obj[f.key])) input.insertAdjacentHTML('beforeend', `<option value="${esc(obj[f.key])}">⚠️ introuvable</option>`);
        input.value = obj[f.key] ?? '';
        input.addEventListener('change', () => set(input.value));
      } else {
        // secret: the bot sends back "••••••••" when it is set (the real password never comes back to the browser)
        const type = { int: 'number', color: 'color', secret: 'password' }[f.type] ?? 'text';
        input = Object.assign(document.createElement('input'), { type, value: obj[f.key] ?? '' });
        if (f.type === 'secret') Object.assign(input, { autocomplete: 'new-password', placeholder: 'Non réglé' });
        if (f.type === 'int') Object.assign(input, { min: f.min, max: f.max, step: 1 });
        if (f.max && f.type === 'text') input.maxLength = f.max;
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.emoji) input.dataset.emoji = ''; // emoji field: the emoji picker opens on click (emoji-picker.js)
        input.addEventListener('input', () => set(f.type === 'int' ? (input.value === '' ? '' : Number(input.value)) : input.value));
      }
      el.append(input);
    }
    if (f.help) el.insertAdjacentHTML('beforeend', `<small>${esc(f.help)}</small>`);
    el._obj = obj;
    return el;
  }

  function buildFields(container, fields, obj, onChange, rerender) {
    let grid = null; // numbers and small menus side by side
    for (const f of fields) {
      if (f.type === 'hidden') continue;
      if (f.type === 'section') {
        container.insertAdjacentHTML('beforeend', `<h3 class="ff-section">${esc(f.label)}</h3>`);
        grid = null;
        continue;
      }
      const el = fieldEl(f, obj, onChange, rerender);
      const small = ['int', 'select', 'channel', 'voice', 'category', 'role', 'color'].includes(f.type);
      if (small) {
        if (!grid) {
          grid = Object.assign(document.createElement('div'), { className: 'grid2' });
          container.append(grid);
        }
        grid.append(el);
      } else {
        grid = null;
        container.append(el);
      }
    }
  }

  // Fields shown only if another field has a certain value (when: [key, value])
  function refreshWhen() {
    for (const el of $$('[data-when]')) {
      const [key, value] = JSON.parse(el.dataset.when);
      el.hidden = el._obj[key] !== value;
    }
  }

  // ---------- Info under the form ----------

  function extraHtml(extra = {}) {
    let html = (extra.notes ?? []).map((n) => `<div class="alert">${esc(n)}</div>`).join('');
    if (extra.list) {
      const rows = extra.list.rows.length
        ? extra.list.rows
            .map(
              (r) => `<div class="item">
                ${r.avatar ? `<img class="ff-avatar" src="${esc(r.avatar)}" alt="">` : r.icon ? `<div class="item-icon">${esc(r.icon)}</div>` : ''}
                <div class="item-main"><strong>${esc(r.main)}</strong><span class="muted small">${esc(r.sub ?? '')}</span></div>
                ${(r.actions ?? []).map((a) => `<button class="btn small ${a.danger ? 'danger' : 'ghost'}" data-action="${esc(a.id)}" data-confirm="${esc(a.confirm ?? '')}">${esc(a.label)}</button>`).join('')}
              </div>`,
            )
            .join('')
        : `<div class="list-empty">${esc(extra.list.empty)}</div>`;
      html += `<div class="card"><h2>${esc(extra.list.title)}</h2><div class="item-list">${rows}</div></div>`;
    }
    // Charts (e.g. game server players): drawn by drawCharts once the page is in place
    if (extra.charts?.length) {
      html += `<div class="card"><div class="card-head"><h2>📈 Historique</h2><div class="range-switch" data-range>
          <button type="button" data-hours="24" class="${chartHours === 24 ? 'on' : ''}">24 h</button><button type="button" data-hours="168" class="${chartHours === 168 ? 'on' : ''}">7 jours</button>
        </div></div>${extra.charts.map((_, i) => `<div data-chart="${i}"></div>`).join('')}</div>`;
    }
    const buttons = [
      ...(extra.links ?? []).map((l) => `<a class="btn ghost" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`),
      ...(extra.actions ?? []).map((a) => `<button class="btn ${a.danger ? 'danger' : 'ghost'}" data-action="${esc(a.id)}" data-confirm="${esc(a.confirm ?? '')}">${esc(a.label)}</button>`),
    ];
    if (buttons.length) html += `<div class="actions ff-extra-actions">${buttons.join('')}</div>`;
    return html;
  }

  let chartHours = 24;
  function drawCharts(panel, extra = {}) {
    const to = Date.now();
    (extra.charts ?? []).forEach((c, i) => {
      const box = $(`[data-chart="${i}"]`, panel);
      if (box) lineChart(box, c.points, { title: c.title, from: to - chartHours * 3600000, to, empty: 'Pas encore de données : l’historique se remplit à chaque vérification.' });
    });
  }

  // ---------- Tab ----------

  const url = (name, rest = '') => `/api/guilds/${state.guildId}/features/${name}${rest}`;
  const isDirty = (f) => JSON.stringify(f.draft) !== JSON.stringify(f.saved);

  function render(name) {
    const f = forms[name];
    const panel = $(`#tab-${name}`);
    const { schema } = f;
    panel.innerHTML = `<h1>${schema.icon} ${esc(schema.title)}</h1>
      <p class="muted">${esc(schema.intro)}</p>
      <div class="card">
        <div class="card-head"><h2>Réglages</h2>${schema.toggle ? '<label class="switch" title="Activer / désactiver"><input type="checkbox" data-enabled><span></span></label>' : ''}</div>
        <div class="ff-form"></div>
        <div class="actions ff-save"><button class="btn primary" data-save>Enregistrer</button><span class="muted small ff-dirty hidden">Modifications non enregistrées</span></div>
      </div>
      <div class="ff-extra">${extraHtml(f.extra)}</div>`;

    const onChange = () => $('.ff-dirty', panel).classList.toggle('hidden', !isDirty(f));
    buildFields($('.ff-form', panel), schema.fields, f.draft, onChange, () => render(name));
    refreshWhen();
    onChange();
    drawCharts(panel, f.extra);

    const toggle = $('[data-enabled]', panel);
    if (toggle) {
      toggle.checked = f.draft.enabled;
      toggle.addEventListener('change', () => {
        f.draft.enabled = toggle.checked;
        onChange();
      });
    }

    $('[data-save]', panel).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const result = await api('PUT', url(name), f.draft);
        Object.assign(f, { saved: result.config, draft: structuredClone(result.config), extra: result.extra });
        state.data.features[name] = { enabled: Boolean(result.config.enabled), count: result.config.list?.length ?? 0 };
        renderHome();
        render(name);
        toast('Enregistré ✅');
      } catch (error) {
        toast(error.message, 'error');
        e.target.disabled = false;
      }
    });

    $('.ff-extra', panel).addEventListener('click', async (e) => {
      // 24 h / 7 days: charts are redrawn without asking the bot anything
      const hours = Number(e.target.dataset.hours);
      if (hours) {
        chartHours = hours;
        $$('[data-range] button', panel).forEach((b) => b.classList.toggle('on', Number(b.dataset.hours) === hours));
        return drawCharts(panel, f.extra);
      }
      const { action, confirm: question } = e.target.dataset;
      if (!action || (question && !confirm(question))) return;
      e.target.disabled = true;
      try {
        const result = await api('POST', url(name, `/actions/${encodeURIComponent(action)}`));
        // The action changed the settings (e.g. server deleted): the form is reloaded, otherwise only the bottom part
        if (JSON.stringify(result.config) !== JSON.stringify(f.saved)) {
          Object.assign(f, { saved: result.config, draft: structuredClone(result.config), extra: result.extra });
          render(name);
        } else {
          f.extra = result.extra;
          $('.ff-extra', panel).innerHTML = extraHtml(f.extra);
          drawCharts(panel, f.extra);
        }
        toast(result.message ?? 'Fait ✅');
      } catch (error) {
        toast(error.message, 'error');
        e.target.disabled = false;
      }
    });
  }

  async function load(name) {
    const panel = $(`#tab-${name}`);
    if (forms[name]?.guildId !== state.guildId) panel.innerHTML = '<div class="list-empty">Chargement…</div>';
    try {
      const data = await api('GET', url(name));
      forms[name] = { guildId: state.guildId, schema: data.schema, saved: data.config, draft: structuredClone(data.config), extra: data.extra };
      render(name);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  // Called by app.js every time a tab is opened
  Object.assign(window.moduleTabs, Object.fromEntries(NAMES.map((name) => [name, () => load(name)])));
})();

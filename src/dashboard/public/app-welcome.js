// Welcome tab: messages (welcome, DM, goodbye, automatic roles) and the visual editor of the welcome image
// (drawn by card-renderer.js, the same code as the bot). Relies on app.js (state, changed…) and common.js.

// ---------- Welcome: visual editor ----------
// Drawing uses card-renderer.js, the same code as the bot: the preview is the final image.

const R = window.CardRenderer;
const canvas = $('#w-canvas');
const ctx = canvas.getContext('2d');
const editor = { selected: 'background', boxes: {}, banner: null, bannerSrc: null, bannerVersion: Date.now(), avatar: null, drag: null, snapX: false, snapY: false, updaters: [] };
const loadedFonts = new Set();

const welcome = () => state.edit.welcome;
const findEl = (id) => welcome().elements.find((e) => e.id === id);
const newId = () => `t${Date.now().toString(36)}`;

// Images from another site (the Discord avatar) are asked with CORS: otherwise the browser "taints" the canvas they are
// drawn on, and the preview can no longer be exported from it
function loadImg(src) {
  return new Promise((resolve) => {
    const img = new Image();
    if (/^https?:/.test(src) && new URL(src).origin !== location.origin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function loadBanner() {
  // Custom banner, otherwise none: plain background (the old "Par défaut" setting means "Aucune")
  const src = welcome().banner === 'custom' ? `/api/guilds/${state.guildId}/welcome/banner?v=${editor.bannerVersion}` : '';
  if (src === editor.bannerSrc) return;
  editor.bannerSrc = src;
  const img = src ? await loadImg(src) : null;
  if (editor.bannerSrc !== src) return; // another banner was chosen in the meantime
  editor.banner = img;
  redraw();
}

function loadFonts() {
  return Promise.all(
    state.data.fonts
      .filter((f) => !loadedFonts.has(f.family))
      .map(async (f) => {
        try {
          const face = await new FontFace(f.family, `url(/fonts/${encodeURIComponent(f.file)})`).load();
          document.fonts.add(face);
          loadedFonts.add(f.family);
          redraw();
        } catch {
          // font the browser can't read: the preview will use the fallback font
        }
      }),
  );
}

// ---------- Drawing ----------

// Like the bot: the default texts of the image (unchanged) are drawn in the server language
const defaultsToEnglish = I18N.createTranslator(I18N_EN.DEFAULTS, { whole: true });
const cardTranslate = () => (state.data.language === 'en' ? defaultsToEnglish : (text) => text);

let frame = 0;
function redraw() {
  if (!frame) frame = requestAnimationFrame(draw);
}

function draw() {
  frame = 0;
  if (!state.data) return;
  const { user } = state.me;
  const vars = { user: user.username, name: user.username, server: state.data.guild.name, count: state.data.guild.members };
  ctx.clearRect(0, 0, R.W, R.H);
  editor.boxes = R.drawCard(ctx, welcome(), { banner: editor.banner, avatar: editor.avatar }, vars, cardTranslate());
  scheduleWelcomePreview(); // the message preview follows the image (banner loaded, element moved…)

  ctx.save();
  ctx.setLineDash([14, 10]);
  if (editor.drag) {
    // Snapping guides at the center
    ctx.strokeStyle = '#ff4dd2';
    ctx.lineWidth = 3;
    if (editor.snapX) ctx.strokeRect(R.W / 2, -10, 0, R.H + 20);
    if (editor.snapY) ctx.strokeRect(-10, R.H / 2, R.W + 20, 0);
  }
  const box = editor.boxes[editor.selected];
  if (box) {
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(box.x - 10, box.y - 10, box.w + 20, box.h + 20);
    ctx.strokeStyle = PANEL_COLOR;
    ctx.lineDashOffset = 12;
    ctx.strokeRect(box.x - 10, box.y - 10, box.w + 20, box.h + 20);
  }
  ctx.restore();
}

// ---------- Mouse selection and dragging ----------

const toCanvas = (e) => {
  const rect = canvas.getBoundingClientRect();
  return { x: ((e.clientX - rect.left) * R.W) / rect.width, y: ((e.clientY - rect.top) * R.H) / rect.height };
};

// The topmost element under the cursor
function hit(p) {
  const els = welcome().elements;
  for (let i = els.length - 1; i >= 0; i--) {
    const b = editor.boxes[els[i].id];
    if (b && p.x >= b.x - 10 && p.x <= b.x + b.w + 10 && p.y >= b.y - 10 && p.y <= b.y + b.h + 10) return els[i];
  }
  return null;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  const p = toCanvas(e);
  const el = hit(p);
  select(el ? el.id : 'background');
  if (el) {
    editor.drag = { el, dx: p.x - el.x, dy: p.y - el.y, moved: false };
    canvas.setPointerCapture(e.pointerId);
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = toCanvas(e);
  if (!editor.drag) {
    canvas.style.cursor = hit(p) ? 'move' : 'default';
    return;
  }
  const { el } = editor.drag;
  let x = Math.round(p.x - editor.drag.dx);
  let y = Math.round(p.y - editor.drag.dy);
  // Snap to center (horizontal: centered avatar and texts)
  editor.snapX = (el.type === 'avatar' || el.align === 'center') && Math.abs(x - R.W / 2) < 15;
  editor.snapY = Math.abs(y - R.H / 2) < 15;
  if (editor.snapX) x = R.W / 2;
  if (editor.snapY) y = R.H / 2;
  el.x = x;
  el.y = y;
  editor.drag.moved = true;
  syncProps();
  redraw();
});

function endDrag() {
  if (!editor.drag) return;
  const { moved } = editor.drag;
  editor.drag = null;
  editor.snapX = editor.snapY = false;
  if (moved) changed('welcome');
  else redraw();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('keydown', (e) => {
  const el = findEl(editor.selected);
  if (!el) return;
  if (e.key === 'Delete' && el.type === 'text') {
    e.preventDefault();
    return removeElement(el);
  }
  const step = e.shiftKey ? 10 : 1;
  const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!move) return;
  e.preventDefault();
  el.x += move[0];
  el.y += move[1];
  syncProps();
  changed('welcome');
});

function select(id) {
  editor.selected = id;
  renderLayers();
  renderProps();
  redraw();
}

// ---------- Layers ----------

const layerName = (el) => (el.type === 'avatar' ? '🖼️ Avatar' : `🔤 ${el.text.trim() || 'Texte vide'}`);

function renderLayers() {
  const list = $('#w-layers');
  list.replaceChildren();
  const els = welcome().elements;
  // Top layer first, like in a drawing app
  [...els].reverse().forEach((el) => {
    const row = document.createElement('div');
    row.className = `layer${el.id === editor.selected ? ' active' : ''}${el.visible ? '' : ' hidden-layer'}`;
    row.innerHTML = `
      ${dragHandle}
      <button class="icon" data-act="eye" title="Afficher / masquer">${el.visible ? '👁' : '◌'}</button>
      <span class="name"></span>`;
    $('.name', row).textContent = layerName(el);
    row.addEventListener('click', (e) => {
      if (e.target.closest('.drag-handle')) return;
      if (e.target.dataset?.act !== 'eye') return select(el.id);
      el.visible = !el.visible;
      renderLayers();
      changed('welcome');
    });
    list.append(row);
  });
  // The list is shown in reverse (top layer first)
  dragSort(list, (from, to) => {
    moveItem(els, els.length - 1 - from, els.length - 1 - to);
    renderLayers();
    changed('welcome');
  });

  const bg = document.createElement('div');
  bg.className = `layer${editor.selected === 'background' ? ' active' : ''}`;
  bg.innerHTML = '<span class="icon">🎨</span><span class="name">Fond et dégradé</span>';
  bg.addEventListener('click', () => select('background'));
  list.append(bg);
}

// ---------- Settings of the selected element ----------

function wrap(label, control, wide = false) {
  const el = document.createElement('label');
  if (wide) el.className = 'wide';
  el.append(label, control);
  return el;
}

// Slider + number field. percent: the value goes from 0 to 1 but is shown from 0 to 100
function slider(target, key, label, min, max, { percent = false, wide = false } = {}) {
  const box = document.createElement('div');
  box.className = 'slider';
  const range = Object.assign(document.createElement('input'), { type: 'range', min, max, step: 1 });
  const number = Object.assign(document.createElement('input'), { type: 'number', min, max, step: 1 });
  const sync = () => (range.value = number.value = Math.round(percent ? target[key] * 100 : target[key]));
  const set = (raw) => {
    const value = Math.min(max, Math.max(min, Number(raw)));
    if (!Number.isFinite(value)) return;
    target[key] = percent ? value / 100 : value;
    changed('welcome');
  };
  range.addEventListener('input', () => {
    number.value = range.value;
    set(range.value);
  });
  number.addEventListener('input', () => {
    if (number.value === '') return;
    range.value = number.value;
    set(number.value);
  });
  number.addEventListener('blur', sync);
  sync();
  editor.updaters.push(sync);
  box.append(range, number);
  return wrap(label, box, wide);
}

function colorField(target, key, label) {
  const box = document.createElement('span');
  box.className = 'color';
  const picker = Object.assign(document.createElement('input'), { type: 'color', value: target[key] });
  const text = Object.assign(document.createElement('input'), { value: target[key], maxLength: 7 });
  picker.addEventListener('input', () => {
    text.value = target[key] = picker.value;
    changed('welcome');
  });
  text.addEventListener('input', () => {
    const value = text.value.trim();
    if (!HEX.test(value)) return;
    picker.value = target[key] = value;
    changed('welcome');
  });
  box.append(picker, text);
  return wrap(label, box);
}

function segmented(target, key, label, options, onChange) {
  const box = document.createElement('div');
  box.className = 'segmented';
  for (const [value, text, disabled] of options) {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: text, disabled: Boolean(disabled) });
    button.classList.toggle('on', target[key] === value);
    button.addEventListener('click', (e) => {
      e.preventDefault();
      target[key] = value;
      $$('button', box).forEach((b) => b.classList.toggle('on', b === button));
      onChange?.();
      changed('welcome');
    });
    box.append(button);
  }
  return wrap(label, box);
}

function checkbox(target, key, label, onChange) {
  const el = document.createElement('label');
  el.className = 'check';
  const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: target[key] });
  input.addEventListener('change', () => {
    target[key] = input.checked;
    onChange?.();
    changed('welcome');
  });
  el.append(input, label);
  return el;
}

function button(text, onClick, className = 'btn ghost small') {
  const b = Object.assign(document.createElement('button'), { type: 'button', className, textContent: text });
  b.addEventListener('click', onClick);
  return b;
}

function section(title, ...nodes) {
  const head = document.createElement('div');
  head.className = 'head';
  head.innerHTML = `<h3>${esc(title)}</h3>`;
  const fields = document.createElement('div');
  fields.className = 'fields';
  fields.append(...nodes.filter(Boolean));
  return [head, fields];
}

function syncProps() {
  editor.updaters.forEach((fn) => fn());
}

function renderProps() {
  const box = $('#w-props');
  box.replaceChildren();
  editor.updaters = [];
  const el = findEl(editor.selected);
  if (!el) return renderBackgroundProps(box);

  const position = [slider(el, 'x', 'Position X', 0, R.W), slider(el, 'y', 'Position Y', 0, R.H), slider(el, 'opacity', 'Opacité (%)', 0, 100, { percent: true })];
  const actions = document.createElement('div');
  actions.className = 'actions wide';
  actions.append(
    button('Centrer horizontalement', () => {
      el.x = R.W / 2;
      if (el.type === 'text') el.align = 'center';
      renderProps();
      changed('welcome');
    }),
    button('Centrer verticalement', () => {
      el.y = R.H / 2;
      syncProps();
      changed('welcome');
    }),
  );

  if (el.type === 'avatar') {
    box.append(
      ...section(
        'Avatar du membre',
        slider(el, 'size', 'Taille', 20, 1000),
        segmented(el, 'shape', 'Forme', [['circle', 'Rond'], ['rounded', 'Arrondi'], ['square', 'Carré']]),
        slider(el, 'borderWidth', 'Épaisseur de la bordure', 0, 80),
        colorField(el, 'borderColor', 'Couleur de la bordure'),
        slider(el, 'glow', 'Lueur', 0, 150),
        ...position,
        actions,
      ),
    );
    return;
  }

  // Text
  const textInput = Object.assign(document.createElement('input'), { value: el.text, maxLength: 200 });
  textInput.addEventListener('input', () => {
    el.text = textInput.value;
    renderLayers();
    changed('welcome');
  });
  const hint = Object.assign(document.createElement('small'), { textContent: 'Variables : {name} (pseudo) · {server} · {count} (nombre de membres)' });
  const textField = wrap('Texte', textInput, true);
  textField.append(hint);

  const fontSelect = document.createElement('select');
  const custom = state.data.fonts.map((f) => f.family);
  fontSelect.innerHTML =
    (custom.length ? `<optgroup label="Polices importées">${custom.map((f) => `<option>${esc(f)}</option>`).join('')}</optgroup>` : '') +
    `<optgroup label="Polices de base">${R.SYSTEM_FONTS.map((f) => `<option>${esc(f)}</option>`).join('')}</optgroup>`;
  fontSelect.value = el.font;
  fontSelect.addEventListener('change', () => {
    el.font = fontSelect.value;
    changed('welcome');
  });
  const fontField = wrap('Police', fontSelect);
  const fontActions = document.createElement('div');
  fontActions.className = 'actions';
  fontActions.append(button('Importer une police (.ttf / .otf)', () => importFont(el)));
  if (custom.includes(el.font)) fontActions.append(button('Supprimer cette police', () => deleteFont(el.font), 'btn danger small'));
  fontField.append(fontActions);

  actions.append(
    button('Dupliquer', () => {
      const copy = { ...clone(el), id: newId(), x: el.x + 30, y: el.y + 30 };
      welcome().elements.splice(welcome().elements.indexOf(el) + 1, 0, copy);
      select(copy.id);
      changed('welcome');
    }),
    button('Supprimer', () => removeElement(el), 'btn danger small'),
  );

  box.append(
    ...section(
      'Texte',
      textField,
      fontField,
      segmented(el, 'weight', 'Épaisseur', [[400, 'Normal'], [700, 'Gras'], [900, 'Très gras']]),
      slider(el, 'size', 'Taille', 8, 400),
      colorField(el, 'color', 'Couleur'),
      segmented(el, 'align', 'Alignement', [['left', 'Gauche'], ['center', 'Centre'], ['right', 'Droite']]),
      checkbox(el, 'uppercase', 'Tout en majuscules'),
      slider(el, 'shadow', 'Ombre', 0, 60),
      slider(el, 'strokeWidth', 'Contour', 0, 20),
      colorField(el, 'strokeColor', 'Couleur du contour'),
      slider(el, 'maxWidth', 'Largeur max (0 = illimitée)', 0, R.W),
      ...position,
      actions,
    ),
  );
}

function renderBackgroundProps(box) {
  const w = welcome();
  const bannerActions = document.createElement('div');
  bannerActions.className = 'actions wide';
  const upload = Object.assign(document.createElement('label'), { className: 'btn ghost small file', textContent: 'Envoyer une bannière' });
  const file = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
  file.addEventListener('change', () => uploadBanner(file));
  upload.append(file);
  bannerActions.append(upload);
  if (state.data.customBanner) bannerActions.append(button('Supprimer la bannière perso', deleteBanner, 'btn danger small'));
  const bannerHint = Object.assign(document.createElement('small'), {
    className: 'wide',
    textContent: 'Idéal : 1920 × 1080 px (16:9), sinon l’image est recadrée pour remplir la carte. PNG, JPG ou WEBP, 8 Mo max.',
  });

  const o = w.overlay;
  box.append(
    ...section(
      'Bannière',
      segmented(w, 'banner', 'Image de fond', [['none', 'Aucune'], ['custom', 'Perso', !state.data.customBanner]], loadBanner),
      colorField(w, 'background', 'Couleur de fond (sans bannière)'),
      bannerActions,
      bannerHint,
    ),
    ...section(
      'Dégradé',
      checkbox(o, 'enabled', 'Afficher un dégradé par-dessus la bannière'),
      segmented(o, 'mode', 'Direction', [['bottom', 'Bas'], ['top', 'Haut'], ['left', 'Gauche'], ['right', 'Droite'], ['full', 'Plein']]),
      colorField(o, 'color', 'Couleur'),
      slider(o, 'opacity', 'Opacité (%)', 0, 100, { percent: true }),
      slider(o, 'start', 'Début du dégradé (%)', 0, 100, { percent: true }),
    ),
  );
}

function removeElement(el) {
  const els = welcome().elements;
  els.splice(els.indexOf(el), 1);
  select('background');
  changed('welcome');
}

$('#w-add-text').addEventListener('click', () => {
  const el = R.newText(newId(), { text: 'Nouveau texte', x: R.W / 2, y: R.H / 2, size: 72, color: '#ffffff', align: 'center', maxWidth: 0 });
  welcome().elements.push(el);
  select(el.id);
  changed('welcome');
});

$('#w-reset-layout').addEventListener('click', () => {
  if (!confirm('Remettre l’image par défaut ? Les textes, positions, couleurs et le dégradé seront réinitialisés (non enregistré tant que tu ne cliques pas sur Enregistrer).')) return;
  Object.assign(welcome(), clone(R.DEFAULT_LAYOUT));
  select('background');
  changed('welcome');
});

$('#w-render').addEventListener('click', async () => {
  const b = $('#w-render');
  b.disabled = true;
  try {
    const res = await fetch(`/api/guilds/${state.guildId}/welcome/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(welcome()),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Rendu impossible.');
    const img = $('#w-final-img');
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(await res.blob());
    $('#w-final').showModal();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    b.disabled = false;
  }
});
$('#w-final-close').addEventListener('click', () => $('#w-final').close());

// ---------- Banner and fonts ----------

function setBannerMode(mode) {
  state.saved.welcome.banner = mode;
  welcome().banner = mode;
  editor.bannerVersion = Date.now();
  loadBanner();
  renderProps();
  updateSavebar();
}

async function uploadBanner(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return toast('Image trop lourde (8 Mo max).', 'error');
  try {
    await api('POST', `/api/guilds/${state.guildId}/welcome/banner`, { image: await readAsDataUrl(file) });
    state.data.customBanner = true;
    setBannerMode('custom');
    toast('Bannière envoyée ✅');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function deleteBanner() {
  if (!confirm('Supprimer la bannière perso ?')) return;
  try {
    await api('DELETE', `/api/guilds/${state.guildId}/welcome/banner`);
    state.data.customBanner = false;
    setBannerMode('none');
    toast('Bannière perso supprimée');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function importFont(el) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.ttf,.otf' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('Police trop lourde (5 Mo max).', 'error');
    try {
      const { font } = await api('POST', `/api/guilds/${state.guildId}/fonts`, {
        name: file.name.replace(/\.[^.]+$/, ''),
        data: await readAsDataUrl(file),
      });
      if (!state.data.fonts.some((f) => f.family === font.family)) state.data.fonts.push(font);
      await loadFonts();
      el.font = font.family;
      renderProps();
      changed('welcome');
      toast(`Police « ${font.family} » importée ✅`);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  input.click();
}

async function deleteFont(family) {
  if (!confirm(`Supprimer la police « ${family} » ? Les textes qui l’utilisent passeront en Impact.`)) return;
  try {
    await api('DELETE', `/api/guilds/${state.guildId}/fonts/${encodeURIComponent(family)}`);
    state.data.fonts = state.data.fonts.filter((f) => f.family !== family);
    for (const config of [welcome(), state.saved.welcome]) {
      for (const e of config.elements) if (e.font === family) e.font = 'Impact';
    }
    renderProps();
    changed('welcome');
  } catch (error) {
    toast(error.message, 'error');
  }
}

// ---------- Message settings (welcome, DM, roles, goodbye) ----------

// Form field ↔ config setting ("object.key" path)
const W_FIELDS = [
  ['w-enabled', 'enabled', 'checked'],
  ['w-channel', 'channelId'],
  ['w-message', 'message'],
  ['w-card', 'card', 'checked'],
  ['w-embed-author', 'embed.author'],
  ['w-embed-title', 'embed.title'],
  ['w-embed-description', 'embed.description'],
  ['w-embed-footer', 'embed.footer'],
  ['w-embed-thumbnail', 'embed.thumbnail', 'checked'],
  ['w-dm-on', 'dm.enabled', 'checked'],
  ['w-dm', 'dm.message'],
  ['w-autoroles-on', 'autoroles.enabled', 'checked'],
  ['w-bye-on', 'goodbye.enabled', 'checked'],
  ['w-bye-channel', 'goodbye.channelId'],
  ['w-bye', 'goodbye.message'],
];
const wPath = (path) => {
  const keys = path.split('.');
  const last = keys.pop();
  return [keys.reduce((obj, k) => obj[k], welcome()), last];
};
for (const [id, path, prop = 'value'] of W_FIELDS) {
  $(`#${id}`).addEventListener(prop === 'checked' ? 'change' : 'input', (e) => {
    const [obj, key] = wPath(path);
    obj[key] = e.target[prop];
    renderWelcomeSections();
    changed('welcome');
  });
}
bindColor('w-embed-color', (value) => {
  if (!HEX.test(value)) return;
  welcome().embed.color = value;
  changed('welcome');
});
$$('#w-format button').forEach((b) =>
  b.addEventListener('click', () => {
    welcome().format = b.dataset.format;
    renderWelcomeSections();
    changed('welcome');
  }),
);

// Cards collapsed when their switch is off, embed and image editors depending on the choices
function renderWelcomeSections() {
  const w = welcome();
  $$('#tab-welcome .w-section').forEach((s) => s.classList.toggle('hidden', !$(`#${s.dataset.for}`).checked));
  $$('#w-format button').forEach((b) => b.classList.toggle('on', b.dataset.format === w.format));
  $('#w-embed').classList.toggle('hidden', w.format !== 'embed');
  $('#w-message-label').textContent = {
    embed: 'Texte au-dessus de l’embed (optionnel)',
    canvas: 'Texte au-dessus de l’image (optionnel)',
  }[w.format] ?? 'Texte du message';
  $('#w-format-help').textContent = {
    embed: 'Un cadre avec titre, description et champs, l’image de bienvenue à l’intérieur.',
    canvas: 'Seulement l’image de bienvenue, dessinée au nom du membre (éditeur ci-dessous).',
  }[w.format] ?? 'Un message texte, avec l’image de bienvenue en dessous si elle est cochée.';
  // Canvas = the image itself: always attached
  $('#w-card-row').classList.toggle('hidden', w.format === 'canvas');
  $('#w-image-card').classList.toggle('hidden', !w.card && w.format !== 'canvas');
}

// Additional embed fields
function renderEmbedFields() {
  const fields = welcome().embed.fields;
  const list = $('#w-embed-fields');
  list.replaceChildren();
  fields.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'option';
    row.innerHTML = `<div class="option-fields"><input class="label" maxlength="256" placeholder="Nom du champ"><input class="desc" maxlength="1024" placeholder="Valeur du champ"></div>
      <label class="check inline-check" title="Afficher sur la même ligne que le champ voisin"><input type="checkbox"> Côte à côte</label>
      <div class="option-actions"><button class="icon danger" type="button" title="Supprimer">✕</button></div>`;
    const [name, value] = $$('input:not([type])', row);
    const inline = $('input[type=checkbox]', row);
    name.value = f.name;
    value.value = f.value;
    inline.checked = f.inline;
    name.addEventListener('input', () => ((f.name = name.value), changed('welcome')));
    value.addEventListener('input', () => ((f.value = value.value), changed('welcome')));
    inline.addEventListener('change', () => ((f.inline = inline.checked), changed('welcome')));
    $('.icon', row).addEventListener('click', () => {
      fields.splice(i, 1);
      renderEmbedFields();
      changed('welcome');
    });
    list.append(row);
  });
  $('#w-embed-add-field').disabled = fields.length >= 10;
}
$('#w-embed-add-field').addEventListener('click', () => {
  welcome().embed.fields.push({ name: '', value: '', inline: false });
  renderEmbedFields();
  changed('welcome');
});

// ---------- Welcome message preview ----------

let previewTimer = 0;
function scheduleWelcomePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderWelcomePreview, 150);
}

// The welcome image, small, drawn separately (without the editor's selection frames).
// An image that the browser refuses to export (avatar without permission from its site) is left out instead of breaking the preview
function smallCard() {
  const { user } = state.me;
  const draw = (assets) => {
    const small = Object.assign(document.createElement('canvas'), { width: 480, height: 270 });
    const c = small.getContext('2d');
    c.scale(480 / R.W, 270 / R.H);
    R.drawCard(c, welcome(), assets, { user: user.username, name: user.username, server: state.data.guild.name, count: state.data.guild.members }, cardTranslate());
    return small.toDataURL('image/jpeg', 0.8);
  };
  try {
    return draw({ banner: editor.banner, avatar: editor.avatar });
  } catch {
    return draw({ banner: editor.banner, avatar: null });
  }
}

function renderWelcomePreview() {
  if (!state.data || state.tab !== 'welcome') return;
  const w = welcome();
  const { user } = state.me;
  const { guild } = state.data;
  // {user} becomes a blue mention in the preview
  const fill = (text) =>
    markdown(R.fillVars(text, { user: '\u0001', name: user.username, server: guild.name, count: guild.members })).replaceAll('\u0001', `<span class="dc-mention">@${esc(user.username)}</span>`);
  const card = w.card || w.format === 'canvas' ? smallCard() : null;
  const image = card ? `<img class="dc-image" src="${card}" alt="">` : '';
  let body = w.message.trim() ? `<div class="dc-content">${fill(w.message)}</div>` : '';

  if (w.format === 'embed') {
    const e = w.embed;
    body += `<div class="dc-embed" style="border-color:${HEX.test(e.color) ? e.color : '#2f7ff0'}">
      <div class="dc-embed-main">
        <div class="dc-embed-text">
          ${e.author ? `<div class="dc-author">${guild.icon ? `<img src="${esc(guild.icon)}" alt="">` : ''}<span>${fill(e.author)}</span></div>` : ''}
          ${e.title ? `<div class="dc-title">${fill(e.title)}</div>` : ''}
          ${e.description ? `<div class="dc-desc">${fill(e.description)}</div>` : ''}
          ${e.fields.length ? `<div class="dc-fields">${e.fields.map((f) => `<div class="dc-field${f.inline ? ' inline' : ''}"><div class="dc-field-name">${fill(f.name)}</div>${fill(f.value)}</div>`).join('')}</div>` : ''}
        </div>
        ${e.thumbnail ? `<img class="dc-thumb" src="${esc(user.avatarUrl)}" alt="">` : ''}
      </div>
      ${image}
      ${e.footer ? `<div class="dc-footer"><span>${fill(e.footer)}</span></div>` : ''}
    </div>`;
  } else {
    body += image;
  }
  $('#w-preview').innerHTML = `<div class="dc-msg">
    <img class="dc-avatar" src="${esc(state.me.bot.avatar)}" alt="">
    <div class="dc-body"><div class="dc-head"><span class="dc-name">${esc(state.me.bot.name)}</span><span class="dc-bot">BOT</span></div>${body || '<div class="muted small">Message vide</div>'}</div>
  </div>`;
}

function renderWelcomeForm() {
  const w = welcome();
  for (const [id, path, prop = 'value'] of W_FIELDS) {
    const [obj, key] = wPath(path);
    $(`#${id}`)[prop] = obj[key];
  }
  setColor('w-embed-color', w.embed.color);
  chips($('#w-autoroles'), state.data.roles.filter((r) => r.editable), w.autoroles.roles, '@', () => changed('welcome'));
  renderEmbedFields();
  renderWelcomeSections();
  scheduleWelcomePreview();
  $('#w-intent').classList.toggle('hidden', state.data.welcomeIntent);
  if (editor.selected !== 'background' && !findEl(editor.selected)) editor.selected = 'background';
  loadBanner();
  loadFonts();
  renderLayers();
  renderProps();
  redraw();
}

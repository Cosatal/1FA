// Announcements tab: plain message, embed or Components V2, sent now or scheduled, with a Discord-like preview.
// Relies on app.js (state…) and common.js.

// ---------- Announcements ----------
// Draft kept while the page is open (nothing is saved on the bot side, the announcement is just sent)

const newAnnounce = () => ({
  channelId: '',
  mention: '',
  content: '',
  embed: { enabled: true, title: '', description: '', color: '#9b4dff', image: '', footer: true },
  mode: 'embed',
  v2: { accent: true, color: '#9b4dff', blocks: [newBlock('text')] },
});

function newBlock(type) {
  return {
    text: { type, content: '## Titre de l’annonce\nÉcris ton message ici.' },
    section: { type, content: '', thumbnail: '' },
    gallery: { type, urls: [] },
    separator: { type, divider: true, spacing: 'small' },
    buttons: { type, buttons: [{ label: '', url: '' }] },
  }[type];
}
let announce = newAnnounce();

const BLOCK_NAMES = { text: '📝 Texte', section: '🖼️ Texte avec miniature', gallery: '🗂️ Images', separator: '➖ Séparateur', buttons: '🔗 Boutons-liens' };
const MODE_HINTS = {
  embed: 'Le format habituel : un cadre avec titre, description, une image et un pied de page.',
  v2: 'Le nouveau format de Discord : empile librement textes, images, séparateurs et boutons dans un cadre. Titres avec # / ## / ###, petit texte gris avec -#.',
};

for (const field of ['channelId', 'mention', 'content']) {
  const id = { channelId: 'a-channel', mention: 'a-mention', content: 'a-content' }[field];
  $(`#${id}`).addEventListener('input', (e) => {
    announce[field] = e.target.value;
    renderAnnouncePreview();
  });
}
for (const field of ['title', 'description', 'image']) {
  $(`#a-${field}`).addEventListener('input', (e) => {
    announce.embed[field] = e.target.value;
    renderAnnouncePreview();
  });
}
bindColor('a-color', (value) => {
  announce.embed.color = value;
  renderAnnouncePreview();
});
$('#a-embed').addEventListener('change', (e) => {
  announce.embed.enabled = e.target.checked;
  renderAnnounceForm();
});
$('#a-footer').addEventListener('change', (e) => {
  announce.embed.footer = e.target.checked;
  renderAnnouncePreview();
});

$$('#a-mode button').forEach((b) =>
  b.addEventListener('click', () => {
    announce.mode = b.dataset.mode;
    renderAnnounceForm();
  }),
);
$('#a-v2-accent').addEventListener('change', (e) => {
  announce.v2.accent = e.target.checked;
  renderAnnouncePreview();
});
bindColor('a-v2-color', (value) => {
  announce.v2.color = value;
  renderAnnouncePreview();
});
$$('[data-add]').forEach((b) =>
  b.addEventListener('click', () => {
    announce.v2.blocks.push(newBlock(b.dataset.add));
    renderBlocks();
    renderAnnouncePreview();
    $$('#a-blocks .block').at(-1).querySelector('input, textarea')?.focus();
  }),
);

// ---------- Components V2 blocks ----------

function renderBlocks() {
  const blocks = announce.v2.blocks;
  const list = $('#a-blocks');
  list.replaceChildren();
  $('#a-v2-count').textContent = `${blocks.length}/30`;
  $$('[data-add]').forEach((b) => (b.disabled = blocks.length >= 30));

  blocks.forEach((block, i) => {
    const row = document.createElement('div');
    row.className = 'block';
    row.innerHTML = `
      <div class="block-head">
        <strong>${dragHandle}${BLOCK_NAMES[block.type]}</strong>
        <button class="icon danger" data-act="del" title="Supprimer">✕</button>
      </div>
      <div class="block-fields"></div>`;
    $('.block-head', row).addEventListener('click', (e) => {
      if (e.target.dataset?.act !== 'del') return;
      blocks.splice(i, 1);
      renderBlocks();
      renderAnnouncePreview();
    });
    $('.block-fields', row).append(...blockFields(block));
    list.append(row);
  });
  dragSort(list, (from, to) => {
    moveItem(blocks, from, to);
    renderBlocks();
    renderAnnouncePreview();
  });
}

function field(tag, value, onInput, { ai, ...attrs } = {}) {
  const el = Object.assign(document.createElement(tag), attrs, { value });
  if (ai) el.dataset.ai = ai; // "✨ Rédiger" button (ai-write.js)
  el.addEventListener('input', () => {
    onInput(el.value);
    renderAnnouncePreview();
  });
  return el;
}

function blockFields(block) {
  if (block.type === 'text') {
    return [field('textarea', block.content, (v) => (block.content = v), { rows: 5, maxLength: 4000, placeholder: '## Titre\nTon texte…', ai: 'announce' })];
  }
  if (block.type === 'section') {
    return [
      field('textarea', block.content, (v) => (block.content = v), { rows: 4, maxLength: 4000, placeholder: 'Texte affiché à gauche de la miniature' }),
      field('input', block.thumbnail, (v) => (block.thumbnail = v), { placeholder: 'Lien de la miniature (https://…)' }),
    ];
  }
  if (block.type === 'gallery') {
    const hint = Object.assign(document.createElement('small'), { textContent: 'Un lien https par ligne, 10 images maximum.' });
    return [
      field('textarea', block.urls.join('\n'), (v) => (block.urls = v.split('\n').map((u) => u.trim()).filter(Boolean)), {
        rows: 3,
        placeholder: 'https://…\nhttps://…',
      }),
      hint,
    ];
  }
  if (block.type === 'separator') {
    const divider = document.createElement('label');
    divider.className = 'check';
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: block.divider });
    input.addEventListener('change', () => {
      block.divider = input.checked;
      renderAnnouncePreview();
    });
    divider.append(input, 'Afficher une ligne');
    const spacing = document.createElement('div');
    spacing.className = 'segmented';
    for (const [value, text] of [['small', 'Petit espace'], ['large', 'Grand espace']]) {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text });
      b.classList.toggle('on', block.spacing === value);
      b.addEventListener('click', () => {
        block.spacing = value;
        $$('button', spacing).forEach((x) => x.classList.toggle('on', x === b));
        renderAnnouncePreview();
      });
      spacing.append(b);
    }
    return [divider, spacing];
  }
  // Link buttons
  const rows = block.buttons.map((btn, j) => {
    const row = document.createElement('div');
    row.className = 'link-row';
    const del = Object.assign(document.createElement('button'), { type: 'button', className: 'icon danger', textContent: '✕', title: 'Supprimer' });
    del.disabled = block.buttons.length === 1;
    del.addEventListener('click', () => {
      block.buttons.splice(j, 1);
      renderBlocks();
      renderAnnouncePreview();
    });
    row.append(
      field('input', btn.label, (v) => (btn.label = v), { maxLength: 80, placeholder: 'Nom du bouton' }),
      field('input', btn.url, (v) => (btn.url = v), { placeholder: 'https://…' }),
      del,
    );
    return row;
  });
  const add = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost small', textContent: '+ Bouton' });
  add.disabled = block.buttons.length >= 5;
  add.addEventListener('click', () => {
    block.buttons.push({ label: '', url: '' });
    renderBlocks();
    renderAnnouncePreview();
  });
  return [...rows, add];
}

// Components V2 markdown: on top of the rest, # / ## / ### headings and -# small text
function markdownV2(text) {
  return text
    .split('\n')
    .map((line) => {
      const heading = /^(#{1,3}) (.+)$/.exec(line);
      if (heading) return `<div class="dc-h${heading[1].length}">${markdown(heading[2])}</div>`;
      if (line.startsWith('-# ')) return `<div class="dc-subtext">${markdown(line.slice(3))}</div>`;
      return `${markdown(line)}<br>`;
    })
    .join('');
}

function v2BlockHtml(block) {
  if (block.type === 'text') return `<div class="dc-v2-text">${markdownV2(block.content)}</div>`;
  if (block.type === 'section') {
    const thumb = /^https?:\/\/\S+$/.test(block.thumbnail.trim()) ? `<img class="dc-thumb" src="${esc(block.thumbnail.trim())}" alt="" data-hide-broken>` : '';
    return `<div class="dc-section"><div class="dc-v2-text">${markdownV2(block.content)}</div>${thumb}</div>`;
  }
  if (block.type === 'gallery') {
    const urls = block.urls.filter((u) => /^https?:\/\/\S+$/.test(u)).slice(0, 10);
    if (!urls.length) return '';
    return `<div class="dc-gallery n${Math.min(urls.length, 4)}">${urls.map((u) => `<img src="${esc(u)}" alt="" data-hide-broken>`).join('')}</div>`;
  }
  if (block.type === 'separator') return `<div class="dc-sep ${block.spacing}${block.divider ? ' line' : ''}"></div>`;
  return `<div class="dc-links">${block.buttons
    .filter((b) => b.label.trim())
    .map((b) => `<span class="dc-link-btn">${esc(b.label)} <span>↗</span></span>`)
    .join('')}</div>`;
}

function renderAnnounceForm() {
  const a = announce;
  $$('#a-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === a.mode));
  $('#a-mode-hint').textContent = MODE_HINTS[a.mode];
  $('#a-embed-card').classList.toggle('hidden', a.mode !== 'embed');
  $('#a-v2-card').classList.toggle('hidden', a.mode !== 'v2');
  $('#a-v2-accent').checked = a.v2.accent;
  setColor('a-v2-color', a.v2.color);
  renderBlocks();
  $('#a-channel').value = a.channelId;
  $('#a-mention').value = a.mention;
  $('#a-content').value = a.content;
  $('#a-embed').checked = a.embed.enabled;
  $('#a-embed-fields').classList.toggle('hidden', !a.embed.enabled);
  for (const field of ['title', 'description', 'image']) $(`#a-${field}`).value = a.embed[field];
  setColor('a-color', a.embed.color);
  $('#a-footer').checked = a.embed.footer;
  renderAnnouncePreview();
}

function mentionLabel(mention) {
  if (mention === 'everyone' || mention === 'here') return `@${mention}`;
  const role = state.data.roles.find((r) => r.id === mention);
  return role ? `@${role.name}` : '';
}

function renderAnnouncePreview() {
  const a = announce;
  const e = a.embed;
  const { guild } = state.data;
  const color = HEX.test(e.color) ? e.color : '#9b4dff';
  const image = e.image.trim();
  const ping = a.mention ? `<span class="dc-mention">${esc(mentionLabel(a.mention))}</span><br>` : '';
  const content = a.content.trim() ? markdown(a.content.trim()) : '';
  const text = ping || content ? `<div class="dc-content">${ping}${content}</div>` : '';
  const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const v2Color = HEX.test(a.v2.color) ? a.v2.color : '#9b4dff';
  const container = `<div class="dc-container"${a.v2.accent ? ` style="border-left: 4px solid ${v2Color}"` : ''}>${a.v2.blocks.map(v2BlockHtml).join('')}</div>`;

  const embed = a.mode === 'v2'
    ? container
    : e.enabled
    ? `<div class="dc-embed" style="border-color:${color}">
        <div class="dc-embed-text">
          ${e.title.trim() ? `<div class="dc-title">${esc(e.title)}</div>` : ''}
          ${e.description.trim() ? `<div class="dc-desc">${markdown(e.description)}</div>` : ''}
        </div>
        ${/^https?:\/\/\S+$/.test(image) ? `<img class="dc-image" src="${esc(image)}" alt="" data-hide-broken>` : ''}
        ${e.footer ? `<div class="dc-footer">${guild.icon ? `<img src="${esc(guild.icon)}" alt="">` : ''}<span>${esc(guild.name)} • Aujourd’hui à ${now}</span></div>` : ''}
      </div>`
    : '';

  $('#a-preview').innerHTML = `
    <div class="dc-msg">
      <img class="dc-avatar" src="${esc(state.me.bot.avatar)}" alt="">
      <div class="dc-body">
        <div class="dc-head"><span class="dc-name">${esc(state.me.bot.name)}</span><span class="dc-bot">BOT</span></div>
        ${text}${embed}
      </div>
    </div>`;
}

$('#a-send').addEventListener('click', async () => {
  const a = announce;
  if (!a.channelId) return toast('Choisis le salon où poster l’annonce.', 'error');
  const channel = state.data.channels.find((c) => c.id === a.channelId);
  const ping = a.mention ? ` en mentionnant ${mentionLabel(a.mention)}` : '';
  if (!confirm(`Publier l’annonce dans #${channel?.name}${ping} ?`)) return;

  const button = $('#a-send');
  button.disabled = true;
  try {
    const body = { ...a, v2: { color: a.v2.accent ? a.v2.color : '', blocks: a.v2.blocks } };
    const { url } = await api('POST', `/api/guilds/${state.guildId}/announce`, body);
    $('#a-last').innerHTML = `Dernière annonce : <a href="${esc(url)}" target="_blank" rel="noopener">voir sur Discord</a>`;
    toast('Annonce publiée ✅');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

// ---------- Scheduled announcements ----------
// The same announcement, sent by the bot at the chosen date (time of the computer of the person scheduling it)

async function loadScheduled() {
  const box = $('#a-scheduled');
  const { list } = await api('GET', `/api/guilds/${state.guildId}/announce/scheduled`).catch(() => ({ list: [] }));
  const date = (at) => new Date(at).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  box.innerHTML = list.length
    ? list
        .map(
          (s) => `<div class="item"><div class="item-icon">📅</div>
            <div class="item-main"><strong>${esc(date(s.at))} · #${esc(s.channel)}</strong><span class="muted small">${esc(s.preview)} · par ${esc(s.by)}</span></div>
            <button class="btn small danger" data-unschedule="${esc(s.id)}">Annuler</button></div>`,
        )
        .join('')
    : '<div class="list-empty">Aucune annonce programmée.</div>';
}

$('#a-schedule').addEventListener('click', async () => {
  const a = announce;
  if (!a.channelId) return toast('Choisis le salon où poster l’annonce.', 'error');
  const at = new Date($('#a-when').value).getTime();
  if (!at) return toast('Choisis la date et l’heure d’envoi.', 'error');
  const button = $('#a-schedule');
  button.disabled = true;
  try {
    const body = { ...a, v2: { color: a.v2.accent ? a.v2.color : '', blocks: a.v2.blocks }, scheduleAt: at };
    await api('POST', `/api/guilds/${state.guildId}/announce`, body);
    toast('Annonce programmée ✅');
    $('#a-when').value = '';
    loadScheduled();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#a-scheduled').addEventListener('click', async (e) => {
  const id = e.target.dataset.unschedule;
  if (!id || !confirm('Annuler cette annonce programmée ?')) return;
  try {
    await api('DELETE', `/api/guilds/${state.guildId}/announce/scheduled/${id}`);
    toast('Annonce annulée');
    loadScheduled();
  } catch (error) {
    toast(error.message, 'error');
  }
});

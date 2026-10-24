// Module tabs: reaction roles, moderation, polls, giveaways, social alerts.
// Relies on app.js helpers ($, api, toast, esc, markdown, state…). Everything is inside a function so names don't clash.
(() => {
  const gid = () => state.guildId;
  const base = () => `/api/guilds/${gid()}`;
  const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const channelName = (id) => state.data.channels.find((c) => c.id === id)?.name ?? 'salon supprimé';

  const channelOptions = (empty) =>
    `<option value="">${esc(empty)}</option>` + state.data.channels.map((c) => `<option value="${c.id}"># ${esc(c.name)}</option>`).join('');
  const roleOptions = (roles, empty) => `<option value="">${esc(empty)}</option>` + roles.map((r) => `<option value="${r.id}">@${esc(r.name)}</option>`).join('');
  const mentionOptions = (everyoneValue = 'everyone') =>
    `<option value="">Personne</option><option value="${everyoneValue}">@everyone</option>${everyoneValue === 'everyone' ? '<option value="here">@here</option>' : ''}` +
    state.data.roles.map((r) => `<option value="${r.id}">@${esc(r.name)}</option>`).join('');

  // A bot message in the Discord-style preview
  const botMessage = (body) => `<div class="dc-msg">
      <img class="dc-avatar" src="${esc(state.me.bot.avatar)}" alt="">
      <div class="dc-body"><div class="dc-head"><span class="dc-name">${esc(state.me.bot.name)}</span><span class="dc-bot">BOT</span></div>${body}</div>
    </div>`;

  // Button disabled during an action, with the error message as a toast
  async function busy(button, action) {
    button.disabled = true;
    try {
      return await action();
    } catch (error) {
      toast(error.message, 'error');
      return null;
    } finally {
      button.disabled = false;
    }
  }

  // =====================================================================
  // Reaction roles
  // =====================================================================

  const rr = { panels: [], roles: [], draft: null, editingId: null };
  const MODE_NAMES = { buttons: 'Boutons', select: 'Menu déroulant', reactions: 'Réactions' };

  async function loadRoles() {
    closeRoleEditor();
    const data = await api('GET', `${base()}/roles-panels`).catch((error) => toast(error.message, 'error'));
    if (!data) return;
    Object.assign(rr, { panels: data.panels, roles: data.roles });
    $('#rr-perm').classList.toggle('hidden', data.canManageRoles);
    $('#rr-channel').innerHTML = channelOptions('Choisis un salon…');
    renderRoleList();
  }

  function renderRoleList() {
    $('#rr-list').innerHTML = rr.panels.length
      ? rr.panels
          .map(
            (p) => `<div class="item">
              <div class="item-main"><strong>${esc(p.title)}</strong>
                <span class="muted small"># ${esc(channelName(p.channelId))} · ${MODE_NAMES[p.mode]} · ${p.roles.length} rôle${p.roles.length > 1 ? 's' : ''}${p.unique ? ' · un seul à la fois' : ''}</span></div>
              <div class="item-actions"><button class="btn ghost small" data-edit="${p.id}">Modifier</button><button class="btn danger small" data-del="${p.id}">Supprimer</button></div>
            </div>`,
          )
          .join('')
      : '<div class="list-empty">Aucun panneau pour l’instant. Crée le premier !</div>';
  }

  $('#rr-list').addEventListener('click', async (e) => {
    const edit = e.target.dataset.edit;
    const del = e.target.dataset.del;
    if (edit) openRoleEditor(rr.panels.find((p) => p.id === edit));
    if (del && confirm('Supprimer ce panneau ? Son message sera supprimé du salon (les membres gardent leurs rôles).')) {
      await busy(e.target, async () => {
        await api('DELETE', `${base()}/roles-panels/${del}`);
        rr.panels = rr.panels.filter((p) => p.id !== del);
        renderRoleList();
        setModuleStat('rolePanels', rr.panels.length);
        toast('Panneau supprimé');
      });
    }
  });

  $('#rr-new').addEventListener('click', () => openRoleEditor(null));
  $('#rr-cancel').addEventListener('click', closeRoleEditor);

  function openRoleEditor(panel) {
    rr.editingId = panel?.id ?? null;
    rr.draft = panel
      ? structuredClone(panel)
      : { channelId: '', mode: 'buttons', title: '🎭 Choisis tes rôles', description: 'Clique sur un bouton pour obtenir ou retirer un rôle.', unique: false, roles: [] };
    $('#rr-editor-title').textContent = panel ? 'Modifier le panneau' : 'Nouveau panneau';
    $('#rr-editor').classList.remove('hidden');
    $('#rr-list-card').classList.add('hidden');
    renderRoleForm();
  }

  function closeRoleEditor() {
    rr.draft = null;
    $('#rr-editor').classList.add('hidden');
    $('#rr-list-card').classList.remove('hidden');
  }

  function renderRoleForm() {
    const d = rr.draft;
    $('#rr-channel').value = d.channelId;
    $('#rr-title').value = d.title;
    $('#rr-description').value = d.description;
    $('#rr-unique').checked = d.unique;
    $$('#rr-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === d.mode));
    renderRoleRows();
    renderRolePreview();
  }

  for (const [id, key] of [['rr-channel', 'channelId'], ['rr-title', 'title'], ['rr-description', 'description']]) {
    $(`#${id}`).addEventListener('input', (e) => {
      rr.draft[key] = e.target.value;
      renderRolePreview();
    });
  }
  $('#rr-unique').addEventListener('change', (e) => {
    rr.draft.unique = e.target.checked;
    renderRolePreview();
  });
  $$('#rr-mode button').forEach((b) =>
    b.addEventListener('click', () => {
      rr.draft.mode = b.dataset.mode;
      renderRoleForm();
    }),
  );

  function renderRoleRows() {
    const d = rr.draft;
    const max = d.mode === 'reactions' ? 20 : 25;
    $('#rr-count').textContent = `${d.roles.length}/${max}`;
    $('#rr-add').disabled = d.roles.length >= max;
    const list = $('#rr-roles');
    list.replaceChildren();
    d.roles.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'option';
      row.innerHTML = `
        ${dragHandle}
        <input class="emoji" maxlength="64" placeholder="🙂" title="Emoji${d.mode === 'reactions' ? ' (obligatoire)' : ' (optionnel)'}">
        <div class="option-fields">
          <select class="role">${roleOptions(rr.roles, 'Choisis un rôle…')}</select>
          ${d.mode === 'reactions' ? '' : '<input class="label" maxlength="80" placeholder="Texte affiché (par défaut : le nom du rôle)">'}
        </div>
        <div class="option-actions">
          <button class="icon danger" data-act="del" title="Supprimer">✕</button>
        </div>`;
      const bind = (sel, key, event = 'input') => {
        const input = $(sel, row);
        if (!input) return;
        input.value = r[key];
        input.addEventListener(event, () => {
          r[key] = input.value;
          renderRolePreview();
        });
      };
      bind('.emoji', 'emoji');
      bind('.role', 'roleId', 'change');
      bind('.label', 'label');
      row.querySelector('.option-actions').addEventListener('click', (e) => {
        if (e.target.dataset?.act !== 'del') return;
        d.roles.splice(i, 1);
        renderRoleRows();
        renderRolePreview();
      });
      list.append(row);
    });
    dragSort(list, (from, to) => {
      moveItem(d.roles, from, to);
      renderRoleRows();
      renderRolePreview();
    });
  }

  $('#rr-add').addEventListener('click', () => {
    rr.draft.roles.push({ roleId: '', emoji: '', label: '' });
    renderRoleRows();
    $$('#rr-roles .role').at(-1).focus();
  });

  function renderRolePreview() {
    const d = rr.draft;
    if (!d) return;
    const color = PANEL_COLOR;
    const roles = d.roles.filter((r) => r.roleId).map((r) => ({ ...r, name: rr.roles.find((x) => x.id === r.roleId)?.name ?? 'rôle' }));
    const lines = d.mode === 'reactions' ? roles.map((r) => `${r.emoji ? emojiHtml(r.emoji) : '❔'} <span class="dc-mention">@${esc(r.name)}</span>`).join('<br>') : '';
    let below = '';
    if (d.mode === 'buttons') below = `<div class="dc-buttons">${roles.map((r) => `<button class="dc-button grey">${r.emoji ? `${emojiHtml(r.emoji)} ` : ''}${esc(r.label || r.name)}</button>`).join('')}</div>`;
    if (d.mode === 'select') below = `<div class="dc-component"><div class="dc-select"><span>Choisis tes rôles…</span><span>▾</span></div></div>`;
    if (d.mode === 'reactions') below = `<div class="dc-reactions">${roles.map((r) => `<span class="dc-reaction">${r.emoji ? emojiHtml(r.emoji) : '❔'} 1</span>`).join('')}</div>`;
    $('#rr-preview').innerHTML = botMessage(`
      <div class="dc-embed" style="border-color:${color}">
        <div class="dc-title">${esc(d.title)}</div>
        <div class="dc-desc">${markdown(d.description)}${lines ? `<br><br>${lines}` : ''}</div>
        <div class="dc-footer"><span>${d.unique ? 'Un seul rôle à la fois' : esc(state.data.guild.name)}</span></div>
      </div>${below}`);
  }

  $('#rr-publish').addEventListener('click', (e) =>
    busy(e.target, async () => {
      const { panel } = await api('PUT', `${base()}/roles-panels/${rr.editingId ?? 'new'}`, rr.draft);
      rr.panels = rr.editingId ? rr.panels.map((p) => (p.id === panel.id ? panel : p)) : [...rr.panels, panel];
      closeRoleEditor();
      renderRoleList();
      setModuleStat('rolePanels', rr.panels.length);
      toast('Panneau publié ✅');
    }),
  );

  // =====================================================================
  // Moderation
  // =====================================================================

  let mod = null;
  let logGroups = [];
  let intents = {};
  let insultLanguages = [];

  // Sub-tabs: filters, logs, commands, immune roles (commands save on their own)
  $$('#mod-subtabs button').forEach((b) =>
    b.addEventListener('click', () => {
      $$('#mod-subtabs button').forEach((x) => x.classList.toggle('on', x === b));
      $$('#tab-moderation .subpanel').forEach((p) => p.classList.toggle('hidden', p.dataset.sub !== b.dataset.sub));
      $('#mod-savebar').classList.toggle('hidden', b.dataset.sub === 'warnings');
    }),
  );

  async function loadModeration() {
    const data = await api('GET', `${base()}/moderation`).catch((error) => toast(error.message, 'error'));
    if (!data) return;
    ({ logEvents: logGroups, intents, insultLanguages } = data);
    $('#mod-perm').classList.toggle('hidden', data.canManage);
    renderModeration(data.config);

    const missing = [!intents.members && '<b>Server Members Intent</b>', !intents.content && '<b>Message Content Intent</b>'].filter(Boolean);
    $('#mod-intents').innerHTML = `⚠️ Certains logs ont besoin de ${missing.join(' et ')} : active-les dans le Developer Portal (onglet Bot), puis redémarre le bot.`;
    $('#mod-intents').classList.toggle('hidden', !missing.length);

    $('#mod-warnings').innerHTML = data.warnings.length
      ? data.warnings
          .map(
            (w) => `<div class="item"><div class="item-main"><strong>${esc(w.user)}</strong><span class="muted small">${esc(w.reason)}</span></div>
              <span class="muted small">${dateFmt.format(w.at)} · par ${esc(w.by)}</span></div>`,
          )
          .join('')
      : '<div class="list-empty">Aucune infraction.</div>';
  }

  function renderModeration(config) {
    mod = config;
    $('#mod-logs').innerHTML = channelOptions('Aucun');
    $('#mod-logs').value = mod.logsId;
    chips($('#mod-ex-roles'), state.data.roles, mod.exemptRoles, '@');
    chips($('#mod-ex-channels'), state.data.channels, mod.exemptChannels, '# ');

    // Logs: one switch per event, greyed out if the required intent isn't enabled
    const needs = { members: 'Server Members Intent', content: 'Message Content Intent' };
    $('#mod-log-events').innerHTML = logGroups
      .map(
        (g) => `<div class="log-group"><h3>${esc(g.group)}</h3>${g.items
          .map(([key, label, need]) => {
            const off = need && !intents[need];
            return `<label class="toggle-row${off ? ' disabled' : ''}" ${off ? `title="Nécessite ${needs[need]}"` : ''}>
              <span class="switch"><input type="checkbox" data-log="${key}" ${mod.logEvents[key] ? 'checked' : ''}><span></span></span>${esc(label)}${off ? ' ⚠️' : ''}
            </label>`;
          })
          .join('')}</div>`,
      )
      .join('');

    $('#mod-words-on').checked = mod.words.enabled;
    $('#mod-words').value = mod.words.list.join('\n');
    $('#mod-words-timeout').value = mod.words.timeout;
    $('#mod-presets-on').checked = mod.presets.enabled;
    $('#mod-p-profanity').checked = mod.presets.profanity;
    $('#mod-p-sexual').checked = mod.presets.sexual;
    $('#mod-p-slurs').checked = mod.presets.slurs;
    // One checkbox per language of the bot's insult lists
    $('#mod-p-langs').innerHTML = insultLanguages
      .map((l) => `<label class="check"><input type="checkbox" data-lang="${esc(l.id)}" ${mod.presets.languages.includes(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`)
      .join('');
    setModDirty(false);
    $('#mod-invites-on').checked = mod.invites.enabled;
    $('#mod-links-on').checked = mod.links.enabled;
    $('#mod-links').value = mod.links.allow.join('\n');
    $('#mod-mentions-on').checked = mod.mentions.enabled;
    $('#mod-mentions-limit').value = mod.mentions.limit;
    $('#mod-mentions-timeout').value = mod.mentions.timeout;
    $('#mod-spam-on').checked = mod.spam.enabled;
    renderFilterStates();
  }

  // =====================================================================
  // Bot commands: for everyone / staff only. Switch + ✏️ (allowed channels and roles), saved right away
  // =====================================================================

  let commands = [];

  async function loadBotCommands() {
    const data = await api('GET', `${base()}/commands`).catch((error) => toast(error.message, 'error'));
    if (data) renderCommands(data.commands);
  }

  function renderCommands(list) {
    commands = list;
    const limits = (c) =>
      [c.channels.length && `${c.channels.length} salon${c.channels.length > 1 ? 's' : ''}`, c.roles.length && `${c.roles.length} rôle${c.roles.length > 1 ? 's' : ''}`]
        .filter(Boolean)
        .join(' · ');
    const html = (group) => commands
      .filter((c) => Boolean(c.staff) === group)
      .map(
        (c) => `<div class="command${c.enabled ? '' : ' off'}" data-name="${c.name}">
          <div class="cmd-row">
            <div class="cmd-main"><strong>${c.menu ? '🖱️ ' : '/'}${esc(c.name)}</strong><span>${esc(c.description)}</span>${c.staff ? `<em>🛡️ Permission : ${esc(c.staff)}</em>` : ''}${limits(c) ? `<em>Limitée à : ${limits(c)}</em>` : ''}</div>
            <label class="switch" title="Activer / désactiver"><input type="checkbox" data-act="toggle" ${c.enabled ? 'checked' : ''}><span></span></label>
            <button class="icon-btn" data-act="edit" title="Salons et rôles autorisés">✏️</button>
          </div>
          <div class="cmd-edit hidden">
            <div class="grid2">
              <div><label>Salons autorisés (vide = tous)</label><div class="chips" data-chips="channels"></div></div>
              <div><label>Rôles autorisés (vide = tout le monde)</label><div class="chips" data-chips="roles"></div></div>
            </div>
            <small>Les rôles autorisés s’ajoutent aux permissions Discord de la commande. Les administrateurs ont toujours accès.</small>
            <div class="actions"><button class="btn primary small" data-act="save">Enregistrer</button></div>
          </div>
        </div>`,
      )
      .join('');
    $('#cmd-public').innerHTML = html(false);
    $('#cmd-staff').innerHTML = html(true);
  }

  async function saveCommand(c) {
    const { command } = await api('PUT', `${base()}/commands/${c.name}`, { enabled: c.enabled, roles: c.roles, channels: c.channels });
    Object.assign(c, command);
    return command;
  }

  $('#tab-botCommands').addEventListener('click', (e) => {
    const act = e.target.dataset?.act;
    const row = e.target.closest('.command');
    if (!act || !row || act === 'toggle') return;
    const c = commands.find((x) => x.name === row.dataset.name);
    if (act === 'edit') {
      const edit = $('.cmd-edit', row);
      edit.classList.toggle('hidden');
      chips($('[data-chips=channels]', edit), state.data.channels, c.channels, '# ');
      chips($('[data-chips=roles]', edit), state.data.roles, c.roles, '@');
    }
    if (act === 'save') {
      busy(e.target, async () => {
        await saveCommand(c);
        renderCommands(commands);
        toast(`/${c.name} enregistrée ✅`);
      });
    }
  });

  $('#tab-botCommands').addEventListener('change', async (e) => {
    if (e.target.dataset.act !== 'toggle') return;
    const row = e.target.closest('.command');
    const c = commands.find((x) => x.name === row.dataset.name);
    c.enabled = e.target.checked;
    row.classList.toggle('off', !c.enabled);
    try {
      await saveCommand(c);
      toast(`/${c.name} ${c.enabled ? 'activée' : 'désactivée'}`);
    } catch (error) {
      c.enabled = !c.enabled;
      e.target.checked = c.enabled;
      row.classList.toggle('off', !c.enabled);
      toast(error.message, 'error');
    }
  });

  // Cards of disabled filters are greyed out
  function renderFilterStates() {
    $$('#tab-moderation .filter').forEach((card) => card.classList.toggle('off', !$('.switch input', card).checked));
  }
  $$('#tab-moderation .filter .switch input').forEach((input) => input.addEventListener('change', renderFilterStates));

  // Any change in the tab (except the infractions list): reminds the user to save
  function setModDirty(dirty) {
    $('#mod-dirty').classList.toggle('hidden', !dirty);
    $('#mod-savebar').classList.toggle('dirty', dirty);
  }
  const markDirty = (e) => !e.target.closest('[data-sub="warnings"]') && setModDirty(true);
  $('#tab-moderation').addEventListener('input', markDirty);
  $('#tab-moderation').addEventListener('change', markDirty);
  // Removing a role or a channel from the chip lists (a click, not a "change")
  $('#tab-moderation').addEventListener('click', (e) => e.target.closest('.chip button') && setModDirty(true));

  const lines = (id) => $(`#${id}`).value.split(/[\n,]/).map((l) => l.trim()).filter(Boolean);
  const number = (id) => Math.round(Number($(`#${id}`).value) || 0);

  $('#mod-save').addEventListener('click', (e) =>
    busy(e.target, async () => {
      const body = {
        logsId: $('#mod-logs').value,
        logEvents: Object.fromEntries($$('#mod-log-events [data-log]').map((input) => [input.dataset.log, input.checked])),
        exemptRoles: mod.exemptRoles,
        exemptChannels: mod.exemptChannels,
        words: { enabled: $('#mod-words-on').checked, list: lines('mod-words'), timeout: number('mod-words-timeout') },
        presets: {
          enabled: $('#mod-presets-on').checked,
          profanity: $('#mod-p-profanity').checked,
          sexual: $('#mod-p-sexual').checked,
          slurs: $('#mod-p-slurs').checked,
          languages: $$('#mod-p-langs [data-lang]').filter((input) => input.checked).map((input) => input.dataset.lang),
        },
        invites: { enabled: $('#mod-invites-on').checked },
        links: { enabled: $('#mod-links-on').checked, allow: lines('mod-links') },
        mentions: { enabled: $('#mod-mentions-on').checked, limit: number('mod-mentions-limit'), timeout: number('mod-mentions-timeout') },
        spam: { enabled: $('#mod-spam-on').checked },
      };
      const { config, errors } = await api('PUT', `${base()}/moderation`, body);
      renderModeration(config);
      setModuleStat('moderationFilters', ['words', 'presets', 'invites', 'links', 'mentions', 'spam'].filter((k) => config[k].enabled).length);
      if (errors.length) errors.forEach((message) => toast(message, 'error'));
      else toast('Modération enregistrée ✅ Les règles AutoMod sont à jour.');
    }),
  );

  // =====================================================================
  // Polls
  // =====================================================================

  const poll = { answers: [{ text: '', emoji: '' }, { text: '', emoji: '' }] };

  function loadPolls() {
    const channel = $('#p-channel').value;
    $('#p-channel').innerHTML = channelOptions('Choisis un salon…');
    $('#p-channel').value = channel;
    const mention = $('#p-mention').value;
    $('#p-mention').innerHTML = mentionOptions();
    $('#p-mention').value = mention;
    renderAnswers();
  }

  function renderAnswers() {
    const list = $('#p-answers');
    list.replaceChildren();
    poll.answers.forEach((a, i) => {
      const row = document.createElement('div');
      row.className = 'option';
      row.innerHTML = `<input class="emoji" maxlength="64" placeholder="🙂" title="Emoji (optionnel)">
        <div class="option-fields"><input class="label" maxlength="55" placeholder="Réponse ${i + 1}"></div>
        <div class="option-actions"><button class="icon danger" title="Supprimer">✕</button></div>`;
      for (const [sel, key] of [['.emoji', 'emoji'], ['.label', 'text']]) {
        const input = $(sel, row);
        input.value = a[key];
        input.addEventListener('input', () => {
          a[key] = input.value;
          renderPollPreview();
        });
      }
      const del = $('.icon', row);
      del.disabled = poll.answers.length <= 2;
      del.addEventListener('click', () => {
        poll.answers.splice(i, 1);
        renderAnswers();
      });
      list.append(row);
    });
    $('#p-add').disabled = poll.answers.length >= 10;
    renderPollPreview();
  }

  $('#p-add').addEventListener('click', () => {
    poll.answers.push({ text: '', emoji: '' });
    renderAnswers();
    $$('#p-answers .label').at(-1).focus();
  });
  for (const id of ['p-question', 'p-duration', 'p-multi', 'p-mention']) $(`#${id}`).addEventListener('input', renderPollPreview);

  function renderPollPreview() {
    const question = $('#p-question').value.trim() || 'Ta question';
    const hours = Number($('#p-duration').value);
    const left = hours >= 24 ? `${hours / 24} j` : `${hours} h`;
    const mention = $('#p-mention').selectedOptions[0];
    $('#p-preview').innerHTML = botMessage(`
      ${$('#p-mention').value ? `<div class="dc-content"><span class="dc-mention">${esc(mention.textContent)}</span></div>` : ''}
      <div class="dc-poll">
        <div class="dc-poll-q">${esc(question)}</div>
        <div class="dc-poll-hint">${$('#p-multi').checked ? 'Sélectionne une ou plusieurs réponses' : 'Sélectionne une réponse'}</div>
        ${poll.answers
          .map((a, i) => `<div class="dc-poll-a">${a.emoji ? `<span>${emojiHtml(a.emoji.trim())}</span>` : ''}<span>${esc(a.text.trim() || `Réponse ${i + 1}`)}</span><span class="dc-poll-check"></span></div>`)
          .join('')}
        <div class="dc-poll-foot">0 vote · ${left} restant${hours > 1 ? 's' : ''}</div>
      </div>`);
  }

  $('#p-send').addEventListener('click', (e) => {
    const channelId = $('#p-channel').value;
    if (!channelId) return toast('Choisis le salon du sondage.', 'error');
    busy(e.target, async () => {
      const { url } = await api('POST', `${base()}/polls`, {
        channelId,
        mention: $('#p-mention').value,
        question: $('#p-question').value,
        answers: poll.answers,
        duration: Number($('#p-duration').value),
        multi: $('#p-multi').checked,
      });
      $('#p-last').innerHTML = `Dernier sondage : <a href="${esc(url)}" target="_blank" rel="noopener">voir sur Discord</a>`;
      toast('Sondage publié ✅');
    });
  });

  // =====================================================================
  // Giveaways
  // =====================================================================

  let giveaways = [];

  async function loadGiveaways() {
    const channel = $('#g-channel').value;
    $('#g-channel').innerHTML = channelOptions('Choisis un salon…');
    $('#g-channel').value = channel;
    $('#g-role').innerHTML = roleOptions(state.data.roles, 'Aucun');
    const data = await api('GET', `${base()}/giveaways`).catch((error) => toast(error.message, 'error'));
    if (!data) return;
    giveaways = data.list;
    renderGiveaways();
  }

  function renderGiveaways() {
    setModuleStat('giveawaysActive', giveaways.filter((g) => !g.ended).length);
    $('#g-list').innerHTML = giveaways.length
      ? giveaways
          .map((g) => {
            const status = g.ended
              ? `<span class="tag-pill">Terminé</span> ${g.winnerIds.length ? `${g.winnerIds.length} gagnant${g.winnerIds.length > 1 ? 's' : ''}` : 'aucun gagnant'}`
              : `<span class="tag-pill live">En cours</span> fin le ${dateFmt.format(g.endsAt)}`;
            const actions = g.ended
              ? `<button class="btn ghost small" data-act="reroll" data-id="${g.id}">🎲 Nouveau tirage</button>`
              : `<button class="btn ghost small" data-act="end" data-id="${g.id}">Terminer maintenant</button>`;
            return `<div class="item">
              <div class="item-main"><strong>🎉 ${esc(g.prize)}</strong>
                <span class="muted small">${status} · # ${esc(channelName(g.channelId))} · ${g.entrants.length} participant${g.entrants.length > 1 ? 's' : ''}</span></div>
              <div class="item-actions">${actions}<button class="btn danger small" data-act="delete" data-id="${g.id}">Supprimer</button></div>
            </div>`;
          })
          .join('')
      : '<div class="list-empty">Aucun giveaway pour l’instant.</div>';
  }

  $('#g-list').addEventListener('click', (e) => {
    const { act, id } = e.target.dataset;
    if (!act) return;
    if (act === 'delete' && !confirm('Supprimer ce giveaway et son message ?')) return;
    if (act === 'end' && !confirm('Terminer le giveaway maintenant et tirer les gagnants ?')) return;
    busy(e.target, async () => {
      if (act === 'delete') {
        await api('DELETE', `${base()}/giveaways/${id}`);
        giveaways = giveaways.filter((g) => g.id !== id);
      } else {
        const { giveaway } = await api('POST', `${base()}/giveaways/${id}/${act}`);
        giveaways = giveaways.map((g) => (g.id === id ? giveaway : g));
      }
      renderGiveaways();
      toast({ delete: 'Giveaway supprimé', end: 'Giveaway terminé 🎉', reroll: 'Nouveau gagnant tiré 🎲' }[act]);
    });
  });

  $('#g-create').addEventListener('click', (e) => {
    const channelId = $('#g-channel').value;
    if (!channelId) return toast('Choisis le salon du giveaway.', 'error');
    busy(e.target, async () => {
      const { giveaway } = await api('POST', `${base()}/giveaways`, {
        channelId,
        prize: $('#g-prize').value,
        description: $('#g-description').value,
        winners: Number($('#g-winners').value),
        minutes: Math.round((Number($('#g-duration').value) * Number($('#g-unit').value)) / 60),
        requiredRoleId: $('#g-role').value,
      });
      giveaways = [giveaway, ...giveaways];
      renderGiveaways();
      $('#g-prize').value = '';
      $('#g-description').value = '';
      toast('Giveaway lancé 🎉');
    });
  });

  // =====================================================================
  // Social alerts
  // =====================================================================

  const RSS_HELP =
    'Cette plateforme n’a pas d’API gratuite. Crée un flux RSS du compte sur <a href="https://rss.app" target="_blank" rel="noopener">rss.app</a> (ou RSSHub), puis colle ici l’adresse du flux.';
  const PLATFORMS = {
    twitch: { icon: '🟣', name: 'Twitch', label: 'Pseudo ou lien de la chaîne', placeholder: 'https://twitch.tv/pseudo' },
    youtube: { icon: '▶️', name: 'YouTube', label: 'Lien de la chaîne ou @pseudo', placeholder: '@Squeezie' },
    reddit: { icon: '🟠', name: 'Reddit', label: 'Subreddit', placeholder: 'r/france' },
    twitter: { icon: '𝕏', name: 'X / Twitter', label: 'Adresse du flux RSS du compte', placeholder: 'https://rss.app/feeds/….xml', help: RSS_HELP },
    instagram: { icon: '📸', name: 'Instagram', label: 'Adresse du flux RSS du compte', placeholder: 'https://rss.app/feeds/….xml', help: RSS_HELP },
    tiktok: { icon: '🎵', name: 'TikTok', label: 'Adresse du flux RSS du compte', placeholder: 'https://rss.app/feeds/….xml', help: RSS_HELP },
    rss: { icon: '📡', name: 'Autre (RSS)', label: 'Adresse du flux RSS', placeholder: 'https://exemple.com/feed.xml' },
  };
  const al = { platform: 'youtube', feeds: [], twitchReady: false, defaults: {} };

  async function loadAlerts() {
    const channel = $('#al-channel').value;
    $('#al-channel').innerHTML = channelOptions('Choisis un salon…');
    $('#al-channel').value = channel;
    $('#al-role').innerHTML = mentionOptions(gid());
    const data = await api('GET', `${base()}/alerts`).catch((error) => toast(error.message, 'error'));
    if (!data) return;
    Object.assign(al, { feeds: data.feeds, twitchReady: data.twitchReady, defaults: data.defaults });
    renderPlatforms();
    renderFeeds();
    loadTwitch();
  }

  function renderPlatforms() {
    const p = PLATFORMS[al.platform];
    $('#al-platforms').innerHTML = Object.entries(PLATFORMS)
      .map(([key, x]) => `<button type="button" class="platform${key === al.platform ? ' on' : ''}" data-p="${key}"><span>${x.icon}</span>${x.name}</button>`)
      .join('');
    $('#al-source-label').textContent = p.label;
    $('#al-source').placeholder = p.placeholder;
    $('#al-message').placeholder = al.defaults[al.platform] ?? '';
    const help =
      al.platform === 'twitch' && !al.twitchReady
        ? state.me.isOwner
          ? '⚠️ Twitch n’est pas encore configuré : règle les identifiants dans le cadre « 🟣 Twitch » juste en dessous.'
          : '⚠️ Twitch n’est pas encore configuré : demande au propriétaire du bot de régler les identifiants Twitch.'
        : p.help;
    $('#al-help').innerHTML = help ?? '';
    $('#al-help').classList.toggle('hidden', !help);
  }

  $('#al-platforms').addEventListener('click', (e) => {
    const key = e.target.closest('[data-p]')?.dataset.p;
    if (!key) return;
    al.platform = key;
    renderPlatforms();
  });

  function renderFeeds() {
    setModuleStat('alerts', al.feeds.length);
    $('#al-list').innerHTML = al.feeds.length
      ? al.feeds
          .map((f) => {
            const p = PLATFORMS[f.platform];
            const status = f.error ? `<span class="error-text">⚠️ ${esc(f.error)}</span>` : f.live ? '<span class="tag-pill live">🔴 En live</span>' : '';
            return `<div class="item">
              <span class="item-icon">${p.icon}</span>
              <div class="item-main"><strong>${esc(f.name)}</strong>
                <span class="muted small">${p.name} → # ${esc(channelName(f.channelId))}${f.roleId ? ' · avec mention' : ''} ${status}</span></div>
              <div class="item-actions">
                <a class="btn ghost small" href="${esc(f.url)}" target="_blank" rel="noopener">Voir</a>
                <button class="btn ghost small" data-act="test" data-id="${f.id}">Tester</button>
                <button class="btn danger small" data-act="delete" data-id="${f.id}">Supprimer</button>
              </div>
            </div>`;
          })
          .join('')
      : '<div class="list-empty">Aucune alerte pour l’instant.</div>';
  }

  $('#al-list').addEventListener('click', (e) => {
    const { act, id } = e.target.dataset;
    if (!act) return;
    if (act === 'delete' && !confirm('Supprimer cette alerte ?')) return;
    busy(e.target, async () => {
      if (act === 'test') {
        await api('POST', `${base()}/alerts/${id}/test`);
        toast('Message de test envoyé ✅ (sans mention)');
      } else {
        await api('DELETE', `${base()}/alerts/${id}`);
        al.feeds = al.feeds.filter((f) => f.id !== id);
        renderFeeds();
        toast('Alerte supprimée');
      }
    });
  });

  $('#al-add').addEventListener('click', (e) => {
    if (!$('#al-source').value.trim()) return toast('Indique le compte à suivre.', 'error');
    if (!$('#al-channel').value) return toast('Choisis le salon des alertes.', 'error');
    busy(e.target, async () => {
      const { feed } = await api('POST', `${base()}/alerts`, {
        platform: al.platform,
        source: $('#al-source').value,
        channelId: $('#al-channel').value,
        roleId: $('#al-role').value,
        message: $('#al-message').value,
      });
      al.feeds = [...al.feeds, feed];
      renderFeeds();
      $('#al-source').value = '';
      $('#al-message').value = '';
      toast(`Alerte ajoutée pour ${feed.name} ✅`);
    });
  });

  // Twitch credentials (bot owner only, in the alerts tab): shared by every server
  const SOURCE_TEXT = { dashboard: '✓ Configuré', env: '✓ Réglé dans .env' };

  function renderTwitch(s) {
    const twitch = s.twitch.clientIdSource && s.twitch.secretSource;
    $('#set-twitch-status').textContent = SOURCE_TEXT[twitch] ?? 'Non configuré';
    $('#set-twitch-status').classList.toggle('ok', Boolean(twitch));
    $('#set-twitch-id').value = s.twitch.clientId;
    $('#set-twitch-secret').value = '';
    $('#set-twitch-secret').placeholder = s.twitch.secretSource ? '•••••••• (déjà réglé, laisse vide pour garder)' : 'Colle le Client Secret';
  }

  async function loadTwitch() {
    if (!state.me.isOwner) return;
    const data = await api('GET', '/api/bot-settings').catch((error) => toast(error.message, 'error'));
    if (data) renderTwitch(data);
  }

  // After a change: the Twitch platform of the "new alert" form knows right away whether it can be used
  function twitchChanged(data) {
    renderTwitch(data);
    al.twitchReady = Boolean(data.twitch.clientIdSource && data.twitch.secretSource);
    renderPlatforms();
  }

  $('#twitch-card').addEventListener('click', (e) => {
    const { save, test, clear } = e.target.dataset;
    if (save) {
      // Only filled fields are sent: a secret left empty keeps its value
      const secret = $('#set-twitch-secret').value.trim();
      const body = { twitchClientId: $('#set-twitch-id').value, ...(secret && { twitchClientSecret: secret }) };
      busy(e.target, async () => {
        twitchChanged(await api('PUT', '/api/bot-settings', body));
        toast('Enregistré ✅ Clique sur « Tester » pour vérifier.');
      });
    }
    if (test) {
      busy(e.target, async () => {
        await api('POST', `/api/bot-settings/test/${test}`);
        toast('Twitch fonctionne ✅');
      });
    }
    if (clear && confirm('Effacer ces identifiants ? (s’ils sont aussi dans .env, c’est cette valeur qui sera utilisée)')) {
      const body = { twitchClientId: '', twitchClientSecret: '' };
      busy(e.target, async () => {
        twitchChanged(await api('PUT', '/api/bot-settings', body));
        toast('Effacé');
      });
    }
  });

  // Called by app.js every time a tab is opened
  window.moduleTabs = { roles: loadRoles, moderation: loadModeration, botCommands: loadBotCommands, polls: loadPolls, giveaways: loadGiveaways, alerts: loadAlerts };
})();

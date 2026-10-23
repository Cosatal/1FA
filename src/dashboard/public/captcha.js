// "Captcha" tab: verification of new members (features/welcome/captcha.js on the bot side). Security level, attempts
// and delays, own "Enregistrer" button. Relies on common.js and app.js (state, renderHome).
(() => {
  // The 4 security levels, as described to the admins (same as LEVELS in captcha.js)
  const LEVELS = [
    { id: 'permissive', icon: '🛡️', name: 'Permissif', text: 'Le membre choisit le bon code parmi 5 propositions, dans un menu déroulant.', tags: ['5 caractères', 'Lettres + chiffres', 'Délai conseillé : 3 s'] },
    { id: 'standard', icon: '🛡️', name: 'Standard', text: 'Le membre recopie le code de l’image, puis valide.', tags: ['5 caractères', 'Lettres + chiffres', 'Délai conseillé : 3 s'] },
    { id: 'aggressive', icon: '⚔️', name: 'Agressif', text: 'Code plus long incluant des symboles, à recopier.', tags: ['6 caractères', 'Lettres + chiffres + symboles', 'Délai conseillé : 5 s'] },
    { id: 'maximum', icon: '🔒', name: 'Maximum', text: 'Code de 8 caractères avec symboles : le niveau le plus contraignant.', tags: ['8 caractères', 'Lettres + chiffres + symboles', 'Délai conseillé : 10 s'] },
  ];
  // Number fields with − / + buttons: [setting, min, max, step]
  const NUMBERS = { maxFails: [1, 10, 1], cooldown: [1, 60, 1], ttl: [60, 3600, 30] };

  $('#view-guild .content').insertAdjacentHTML(
    'beforeend',
    `<div id="tab-captcha" class="tab-panel hidden">
      <h1>🔐 Captcha</h1>
      <p class="muted">Vérifie que chaque nouveau membre est humain : il doit réussir le captcha pour recevoir le rôle qui lui ouvre le serveur.</p>

      <div class="card">
        <div class="card-head"><h2>Fonctionnement</h2><label class="switch" title="Activer / désactiver"><input type="checkbox" id="cap-enabled"><span></span></label></div>
        <div class="grid2">
          <label>Salon de vérification<select id="cap-channel"></select></label>
          <label>Rôle donné après la vérification<select id="cap-role"></select></label>
        </div>
        <details class="howto">
          <summary>Comment régler le serveur pour le captcha</summary>
          <ol>
            <li>Crée un rôle <b>Vérifié</b> (sous le rôle du bot) et choisis-le ci-dessus.</li>
            <li>Retire à <b>@everyone</b> la permission « Voir les salons » partout, sauf dans le salon de vérification.</li>
            <li>Donne « Voir les salons » au rôle <b>Vérifié</b>. Le bot poste le bouton de vérification à l’enregistrement.</li>
          </ol>
        </details>
      </div>

      <div class="card">
        <h2>Niveau de sécurité</h2>
        <p class="muted small">La difficulté du captcha : longueur du code, caractères utilisés et façon de répondre.</p>
        <div class="cap-levels" id="cap-levels">
          ${LEVELS.map((l) => `<button type="button" class="cap-level" data-level="${l.id}">
            <span class="cap-level-icon">${l.icon}</span>
            <span class="cap-level-body"><strong>${l.name}</strong><span class="muted small">${l.text}</span>
              <span class="cap-tags">${l.tags.map((t) => `<span>${t}</span>`).join('')}</span></span>
          </button>`).join('')}
        </div>
      </div>

      <div class="card">
        <h2>Tentatives et délais</h2>
        <p class="muted small">Nombre d’erreurs tolérées, délai imposé entre deux tentatives et durée de vie d’un code.</p>
        <label>Échecs avant sanction<small>Entre 1 et 10.</small></label>
        ${stepper('maxFails', 'échecs')}
        <div class="cap-toggle">
          <div><strong>Expulser après trop d’échecs</strong><small>Si désactivé, le membre doit simplement demander un nouveau code.</small></div>
          <label class="switch"><input type="checkbox" id="cap-kick"><span></span></label>
        </div>
        <label>Délai entre deux tentatives<small>Imposé par le bot après une erreur. Entre 1 et 60 secondes.</small></label>
        ${stepper('cooldown', 'secondes')}
        <label>Durée de vie d’un code<small>Passé ce délai, le code est refusé et un nouveau captcha est généré. Entre 60 et 3600 secondes.</small></label>
        ${stepper('ttl', 'secondes')}
      </div>

      <div class="actions"><button type="button" class="btn primary" id="cap-save">💾 Enregistrer</button><span id="cap-dirty" class="muted small hidden">Modifications non enregistrées</span></div>
    </div>`,
  );

  function stepper(key, unit) {
    return `<div class="stepper-row"><div class="stepper" data-key="${key}">
        <button type="button" data-step="-1" aria-label="Moins">−</button><input type="number" id="cap-${key}" min="${NUMBERS[key][0]}" max="${NUMBERS[key][1]}"><button type="button" data-step="1" aria-label="Plus">+</button>
      </div><span class="muted">${unit}</span></div>`;
  }

  let draft = null;
  const saved = () => JSON.stringify(state.data.captcha);
  const markDirty = () => $('#cap-dirty').classList.toggle('hidden', JSON.stringify(draft) === saved());

  function render() {
    const { channels, roles } = state.data;
    const options = (list, empty, prefix) => `<option value="">${esc(empty)}</option>${list.map((x) => `<option value="${x.id}">${prefix}${esc(x.name)}</option>`).join('')}`;
    $('#cap-channel').innerHTML = options(channels, 'Choisis un salon…', '# ');
    $('#cap-role').innerHTML = options(roles.filter((r) => r.editable), 'Choisis un rôle…', '@');
    $('#cap-enabled').checked = draft.enabled;
    $('#cap-channel').value = draft.channelId;
    $('#cap-role').value = draft.roleId;
    $('#cap-kick').checked = draft.kick;
    for (const key of Object.keys(NUMBERS)) $(`#cap-${key}`).value = draft[key];
    $$('#cap-levels .cap-level').forEach((b) => b.classList.toggle('on', b.dataset.level === draft.level));
    markDirty();
  }

  $('#cap-enabled').addEventListener('change', (e) => ((draft.enabled = e.target.checked), markDirty()));
  $('#cap-kick').addEventListener('change', (e) => ((draft.kick = e.target.checked), markDirty()));
  $('#cap-channel').addEventListener('change', (e) => ((draft.channelId = e.target.value), markDirty()));
  $('#cap-role').addEventListener('change', (e) => ((draft.roleId = e.target.value), markDirty()));
  $('#cap-levels').addEventListener('click', (e) => {
    const level = e.target.closest('[data-level]')?.dataset.level;
    if (!level) return;
    draft.level = level;
    $$('#cap-levels .cap-level').forEach((b) => b.classList.toggle('on', b.dataset.level === level));
    markDirty();
  });

  // − / + buttons and typed numbers, kept between the limits
  const setNumber = (key, value) => {
    const [min, max] = NUMBERS[key];
    draft[key] = Math.min(max, Math.max(min, Math.round(Number(value) || min)));
    $(`#cap-${key}`).value = draft[key];
    markDirty();
  };
  $$('#tab-captcha .stepper').forEach((box) => {
    const { key } = box.dataset;
    box.addEventListener('click', (e) => {
      const step = Number(e.target.dataset.step);
      if (step) setNumber(key, draft[key] + step * NUMBERS[key][2]);
    });
    $('input', box).addEventListener('change', (e) => setNumber(key, e.target.value));
  });

  $('#cap-save').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const { captcha } = await api('PUT', `/api/guilds/${state.guildId}/captcha`, draft);
      state.data.captcha = captcha;
      draft = clone(captcha);
      render();
      renderHome();
      toast(captcha.enabled ? 'Captcha enregistré ✅ Le message de vérification est à jour.' : 'Captcha enregistré ✅');
    } catch (error) {
      toast(error.message, 'error');
    }
    e.target.disabled = false;
  });

  // Called by app.js every time the tab is opened: starts again from the saved settings
  function open() {
    draft = clone(state.data.captcha);
    render();
  }

  Object.assign(window.moduleTabs, { captcha: open });
})();

// "IA du serveur" tab: the AI of the server (provider, model, key or local AI), used by the ticket assistant and the AI tools.
// Relies on app.js (state, api, toast…) and common.js.

// ---------- Server AI ("IA du serveur" tab) ----------
// A single setting for the whole bot: the AI, the model and the key (or the local AI). The ticket assistant and the AI tools use it

const aiProvider = (id) => state.data.aiProviders.find((p) => p.id === id);
// An AI has a key on this server: the ticket assistant and the AI tools work
const aiUsable = () => state.data.aiProviders.some((p) => p.ready);
let aiDraft = null; // { provider, model } being edited

// Models offered by the chosen AI, loaded once per provider
const aiModels = new Map();
async function loadAiModels(provider) {
  if (!aiProvider(provider)?.ready) return;
  if (!aiModels.has(provider)) {
    aiModels.set(provider, api('GET', `/api/guilds/${state.guildId}/ai-models?provider=${provider}`).then((d) => d.models).catch(() => []));
  }
  const models = await aiModels.get(provider);
  if (aiDraft?.provider === provider) $('#ai-models').innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('');
}

function renderAiTab() {
  aiDraft ??= { ...state.data.ai };
  $('#ai-provider').innerHTML = state.data.aiProviders
    .map((p) => `<option value="${p.id}">${esc(p.name)}${p.own ? (p.local ? ' — ton IA' : ' — ta clé') : p.ready ? ' — clé du bot' : p.local ? ' — non branchée' : ' — clé manquante'}</option>`)
    .join('');
  $('#ai-provider').value = aiDraft.provider;
  $('#ai-model').value = aiDraft.model ?? '';
  renderAiDirty();
  renderAiStatus();
}
const renderAiDirty = () => $('#ai-dirty').classList.toggle('hidden', JSON.stringify(aiDraft) === JSON.stringify(state.data.ai));

function renderAiStatus() {
  const { provider } = aiDraft;
  const p = aiProvider(provider);
  // Server's own key: shown masked with "Supprimer", otherwise a field to paste it
  $('#ai-key').innerHTML = !p
    ? ''
    : p.local
      ? localAiForm(p)
    : p.own
      ? `<div class="ai-key-row"><span>🔑 Clé ${esc(p.name)} du serveur : <b>•••• ${esc(p.ending)}</b></span>
          <button class="btn danger small" type="button" data-ai-key="delete">Supprimer</button></div>`
      : `<div class="ai-key-head"><strong>🔑 Clé ${esc(p.name)} de ton serveur</strong><a href="${esc(p.site)}" target="_blank" rel="noopener" class="small">Obtenir une clé ↗</a></div>
        <div class="ai-key-row">
          <input type="password" id="ai-key-input" autocomplete="new-password" spellcheck="false" placeholder="Colle ta clé API">
          <button class="btn primary small" type="button" data-ai-key="save">Enregistrer</button>
        </div>
        <small>${p.shared ? 'Facultatif : sans clé, le serveur utilise celle du bot.' : 'Les réponses de l’IA sont facturées sur ce compte. La clé est testée puis gardée secrète (personne ne peut la revoir).'}</small>`;
  // The chosen AI has no key: the bot uses another one that has a key, otherwise the AI features don't work
  const fallback = !p?.ready && state.data.aiProviders.find((x) => x.ready);
  const status = p?.ready
    ? ''
    : `⚠️ ${p?.local ? 'L’IA locale n’est pas branchée' : `Pas de clé ${p?.name ?? ''}`} : ${fallback ? `en attendant, le bot utilise ${fallback.name}.` : 'en attendant, l’assistant des tickets et les outils IA ne fonctionnent pas.'}`;
  $('#ai-status').textContent = status;
  $('#ai-status').classList.toggle('hidden', !status);
  $('#ai-model').placeholder = provider === 'anthropic' ? 'Par défaut (recommandé)' : 'Automatique, ou choisis un modèle…';
  $('#ai-models').innerHTML = '';
  loadAiModels(provider);
}

$('#ai-provider').addEventListener('change', (e) => {
  aiDraft = { provider: e.target.value, model: '' };
  $('#ai-model').value = '';
  renderAiDirty();
  renderAiStatus();
});
$('#ai-model').addEventListener('input', (e) => {
  aiDraft.model = e.target.value.trim();
  renderAiDirty();
});
$('#ai-save').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const { ai } = await api('PUT', `/api/guilds/${state.guildId}/ai`, aiDraft);
    state.data.ai = ai;
    aiDraft = { ...ai };
    toast('IA du serveur enregistrée ✅');
    renderAiTab();
    renderTicketAiUsed();
  } catch (error) {
    toast(error.message, 'error');
  }
  e.target.disabled = false;
});

// Server's local AI: it runs on their side (their PC), the bot hosted on a VPS reaches it through an https tunnel
function localAiForm(p) {
  if (p.own) {
    return `<div class="ai-key-row"><span>🖥️ IA locale du serveur : <b translate="no">${esc(p.url)}</b>${p.hasKey ? ' (avec clé)' : ''}</span>
      <button class="btn danger small" type="button" data-ai-key="delete">Supprimer</button></div>`;
  }
  return `<div class="ai-key-head"><strong>🖥️ Brancher ton IA locale</strong><a href="${esc(p.site)}" target="_blank" rel="noopener" class="small">Installer Ollama ↗</a></div>
    <small class="ai-local-help">Gratuit et privé : l’IA tourne sur <b>ton</b> PC, et le bot la joint par Internet grâce à un tunnel gratuit.<br>
      1. Installe Ollama, puis lance <code>ollama pull llama3.2</code><br>
      2. Ouvre un tunnel : <code>cloudflared tunnel --url http://localhost:11434 --http-host-header localhost:11434</code>
      (ou <code>ngrok http 11434 --host-header=rewrite</code>)<br>
      3. Colle ci-dessous l’adresse https donnée, suivie de <code>/v1</code><br>
      Ton PC doit rester allumé pour que l’IA réponde. Garde cette adresse pour toi : elle donne accès à ton IA.</small>
    <div class="ai-key-row">
      <input id="ai-local-url" spellcheck="false" placeholder="https://xxxx.trycloudflare.com/v1">
      <input type="password" id="ai-key-input" autocomplete="new-password" spellcheck="false" placeholder="Clé (facultative)">
      <button class="btn primary small" type="button" data-ai-key="save">Tester et enregistrer</button>
    </div>
    ${p.shared ? '<small>Facultatif : sans adresse, le serveur utilise l’IA locale du bot.</small>' : ''}`;
}

// Save (after a test on the bot side) or delete the key of the chosen AI
$('#ai-key').addEventListener('click', async (e) => {
  const action = e.target.dataset.aiKey;
  if (!action) return;
  const { provider } = aiDraft;
  const local = aiProvider(provider)?.local;
  const url = `/api/guilds/${state.guildId}/ai-keys/${provider}`;
  const key = $('#ai-key-input')?.value.trim() ?? '';
  const localUrl = $('#ai-local-url')?.value.trim() ?? '';
  if (action === 'save' && local && !localUrl) return toast('Colle d’abord l’adresse https de ton IA locale.', 'error');
  if (action === 'save' && !local && !key) return toast('Colle d’abord la clé.', 'error');
  if (action === 'delete' && !confirm(local ? 'Débrancher l’IA locale de ce serveur ?' : 'Supprimer la clé IA de ce serveur ?')) return;
  e.target.disabled = true;
  if (action === 'save' && local) e.target.textContent = 'Test en cours…';
  try {
    const result = action === 'save' ? await api('PUT', url, local ? { url: localUrl, key } : { key }) : await api('DELETE', url);
    state.data.aiProviders = result.providers;
    aiModels.delete(provider);
    // Key added for another AI than the saved one: it becomes the server's AI
    if (action === 'save' && state.data.ai.provider !== provider) {
      const { ai } = await api('PUT', `/api/guilds/${state.guildId}/ai`, aiDraft);
      state.data.ai = ai;
      aiDraft = { ...ai };
    }
    toast(
      action === 'save'
        ? `${local ? 'IA locale branchée' : 'Clé enregistrée'} ✅ (${result.models} modèles disponibles)`
        : local ? 'IA locale débranchée' : 'Clé supprimée',
    );
    renderAiTab();
    renderTicketAiUsed();
  } catch (error) {
    toast(error.message, 'error');
    e.target.disabled = false;
  }
});

// Tickets tab: the AI that will answer (set in "IA du serveur")
function renderTicketAiUsed() {
  const choice = aiProvider(state.data.ai.provider);
  const used = choice?.ready ? choice : state.data.aiProviders.find((p) => p.ready);
  const model = used && used === choice && state.data.ai.model ? ` · ${esc(state.data.ai.model)}` : '';
  $('#t-ai-used').innerHTML = used
    ? `<div class="ai-used-row"><span>🧠 IA utilisée : <b>${esc(used.name)}</b>${model}</span><a class="btn ghost small" href="#${state.guildId}/ai">Changer l’IA ou la clé</a></div>`
    : `<div class="alert">⚠️ Aucune IA n’a de clé sur ce serveur : l’assistant ne répondra pas. <a href="#${state.guildId}/ai">Ajouter une clé dans 🧠 IA du serveur</a></div>`;
  renderTicketPreview();
}

$('#t-ai-instructions').addEventListener('input', (e) => {
  state.edit.tickets.ai.instructions = e.target.value;
  changed('tickets');
});

// "Statistiques" tab (server activity charts) and "Sauvegarde" tab (settings export / import).
// Relies on common.js, app.js (state) and chart.js (barChart).
(() => {
  const content = $('#view-guild .content');
  content.insertAdjacentHTML(
    'beforeend',
    `<div id="tab-stats" class="tab-panel hidden">
      <div class="card-head"><h1>📈 Statistiques</h1><div class="range-switch" id="stats-range">
        <button type="button" data-days="7">7 jours</button><button type="button" data-days="30" class="on">30 jours</button><button type="button" data-days="90">90 jours</button>
      </div></div>
      <p class="muted">L’activité de ton serveur, comptée par le bot depuis son arrivée (heure de Paris).</p>
      <div id="stats-body"><div class="list-empty">Chargement…</div></div>
    </div>
    <div id="tab-backup" class="tab-panel hidden">
      <h1>💾 Sauvegarde</h1>
      <p class="muted">Télécharge tous les réglages du bot pour ce serveur, pour les restaurer plus tard ou les copier sur un autre serveur.</p>
      <div class="card">
        <h2>Exporter</h2>
        <p class="muted small">Un fichier JSON avec les réglages de tous les modules. Les clés IA et les mots de passe RCON n’y sont jamais.</p>
        <button class="btn primary" id="backup-export">⬇️ Télécharger la sauvegarde</button>
      </div>
      <div class="card">
        <h2>Importer</h2>
        <p class="muted small">Remplace les réglages actuels par ceux du fichier. Chaque partie est vérifiée : celle qui ne convient pas à ce serveur
          (salon ou rôle introuvable…) est ignorée, les autres sont importées. Ensuite, ouvre Tickets et Bienvenue et clique sur Enregistrer pour reposter leurs messages.</p>
        <label class="btn ghost file">📂 Choisir un fichier de sauvegarde<input type="file" id="backup-file" accept="application/json,.json" hidden></label>
        <div id="backup-results" class="backup-results"></div>
      </div>
    </div>`,
  );

  // ---------- Statistics ----------

  let days = 30;
  const fmt = new Intl.NumberFormat('fr-FR');
  const dayLabel = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const dayTip = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  async function loadStats() {
    const body = $('#stats-body');
    let data;
    try {
      data = await api('GET', `/api/guilds/${state.guildId}/stats?days=${days}`);
    } catch (error) {
      body.innerHTML = `<div class="alert">${esc(error.message)}</div>`;
      return;
    }
    const sum = (key) => data.days.reduce((n, d) => n + d[key], 0);
    const peak = data.hours.indexOf(Math.max(...data.hours));
    const warnings = [
      !data.intents.members && 'Les arrivées et départs ont besoin de Server Members Intent (Developer Portal → Bot).',
    ].filter(Boolean);
    body.innerHTML = `
      ${warnings.map((w) => `<div class="alert">⚠️ ${esc(w)}</div>`).join('')}
      <div class="kpis">
        <div class="kpi"><strong>${fmt.format(data.members)}</strong><span>membres aujourd’hui</span></div>
        <div class="kpi"><strong>${fmt.format(sum('messages'))}</strong><span>messages sur ${days} jours</span></div>
        <div class="kpi"><strong>+${fmt.format(sum('joins'))}</strong><span>arrivées</span></div>
        <div class="kpi"><strong>−${fmt.format(sum('leaves'))}</strong><span>départs</span></div>
        <div class="kpi"><strong>${Math.max(...data.hours) ? `${peak} h` : '—'}</strong><span>heure de pointe</span></div>
      </div>
      <div class="card"><div id="chart-messages"></div><div id="chart-hours"></div></div>
      <div class="split">
        <div class="card"><div id="chart-joins"></div></div>
        <div class="card"><div id="chart-leaves"></div></div>
      </div>
      <div class="card">
        <h2>🏆 Membres les plus actifs ${days > 30 ? '(30 derniers jours)' : `(${days} derniers jours)`}</h2>
        <div class="item-list">${
          data.top.length
            ? data.top.map((t, i) => `<div class="item"><img class="ff-avatar" src="${esc(t.avatar)}" alt=""><div class="item-main"><strong>#${i + 1} ${esc(t.name)}</strong><span class="muted small">${fmt.format(t.messages)} message${t.messages > 1 ? 's' : ''}</span></div></div>`).join('')
            : '<div class="list-empty">Pas encore de messages comptés.</div>'
        }</div>
      </div>`;
    const perDay = (key) => data.days.map((d) => ({ label: dayLabel(d.day), tip: dayTip(d.day), value: d[key] }));
    barChart($('#chart-messages'), perDay('messages'), { title: '💬 Messages par jour' });
    barChart($('#chart-hours'), data.hours.map((value, h) => ({ label: `${h} h`, tip: `De ${h} h à ${h + 1} h`, value })), { title: '🕒 Messages par heure de la journée' });
    barChart($('#chart-joins'), perDay('joins'), { title: '📥 Arrivées par jour' });
    barChart($('#chart-leaves'), perDay('leaves'), { title: '📤 Départs par jour' });
  }

  $('#stats-range').addEventListener('click', (e) => {
    const value = Number(e.target.dataset.days);
    if (!value) return;
    days = value;
    $$('#stats-range button').forEach((b) => b.classList.toggle('on', b === e.target));
    loadStats();
  });

  // ---------- Backup ----------

  $('#backup-export').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const res = await fetch(`/api/guilds/${state.guildId}/backup`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Export impossible.');
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'sauvegarde.json';
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: name });
      link.click();
      URL.revokeObjectURL(link.href);
      toast('Sauvegarde téléchargée ✅');
    } catch (error) {
      toast(error.message, 'error');
    }
    e.target.disabled = false;
  });

  $('#backup-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return toast('Ce fichier n’est pas un JSON valide.', 'error');
    }
    const from = data?.guild?.name ? ` (sauvegarde de « ${data.guild.name} »)` : '';
    if (!confirm(`Remplacer les réglages de ce serveur par ceux du fichier${from} ?`)) return;
    try {
      const { results } = await api('POST', `/api/guilds/${state.guildId}/backup`, data);
      $('#backup-results').innerHTML = `<div class="item-list">${results
        .map((r) => `<div class="item"><div class="item-icon">${r.ok ? '✅' : '⚠️'}</div><div class="item-main"><strong>${esc(r.label)}</strong><span class="muted small">${r.ok ? 'Importé' : esc(r.error)}</span></div></div>`)
        .join('')}</div>`;
      toast('Import terminé : recharge la page pour voir les nouveaux réglages.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  Object.assign(window.moduleTabs, { stats: loadStats });
})();

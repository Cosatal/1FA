// Public level leaderboard of a server: /leaderboard/<server id>
const guildId = location.pathname.split('/').pop();
let page = 0;

function show() {} // used by common.js's api() when the session has expired (useless here: the page is public)

async function loadPage() {
  const data = await api('GET', `/api/public/leaderboard/${guildId}?page=${page}`).catch((error) => {
    $('#list').innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    return null;
  });
  if (!data) return;
  if (page === 0) {
    document.title = `Classement · ${data.guild.name}`;
    $('#guild-name').textContent = data.guild.name;
    $('#guild-info').textContent = `${data.total.toLocaleString('fr-FR')} membres classés`;
    if (data.guild.icon) $('#guild-icon').src = data.guild.icon;
    $('#bot-avatar').src = data.bot.avatar;
    $('#bot-name').textContent = data.bot.name;
    $('#list').innerHTML = data.users.length ? '' : '<div class="empty">Personne n’a encore gagné d’XP.</div>';
  }
  $('#list').insertAdjacentHTML(
    'beforeend',
    data.users
      .map(
        (u) => `<div class="lb-row">
          <span class="lb-rank">#${u.rank}</span>
          <img src="${esc(u.avatar)}" alt="" loading="lazy">
          <div><div class="lb-name">${esc(u.name)}</div>
            <div class="muted small">${u.xp.toLocaleString('fr-FR')} XP · ${u.current.toLocaleString('fr-FR')} / ${u.needed.toLocaleString('fr-FR')}</div>
            <div class="lb-bar"><span style="width:${Math.round((u.current / u.needed) * 100)}%"></span></div></div>
          <div class="lb-level"><span class="muted small">NIVEAU</span><strong>${u.level}</strong></div>
        </div>`,
      )
      .join(''),
  );
  $('#more').classList.toggle('hidden', (page + 1) * 50 >= data.total);
}

$('#more').addEventListener('click', () => {
  page++;
  loadPage();
});
loadPage();

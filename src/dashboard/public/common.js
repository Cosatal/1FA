// Helpers shared by the dashboard (app.js, modules.js) and the staff panel (staff.js)

// Color of the panels posted by the bot (tickets, reaction roles), same as PANEL_COLOR in credits.js
const PANEL_COLOR = '#ed4245';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const esc = (text) =>
  String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Call to the bot API. Session expired: each page shows its login screen with show('login')
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    show('login');
    throw new Error('Session expirée, reconnecte-toi.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur inconnue.');
  return data;
}

function toast(message, type = 'ok') {
  const el = Object.assign(document.createElement('div'), { className: `toast ${type}`, textContent: message });
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4500);
}

// List of chips (roles / channels) with a menu to add more. selected is modified in place
function chips(container, items, selected, prefix, onChange) {
  const render = () => {
    container.innerHTML =
      selected
        .map((id) => `<span class="chip">${prefix}${esc(items.find((i) => i.id === id)?.name ?? id)}<button type="button" data-id="${id}">✕</button></span>`)
        .join('') +
      `<select><option value="">+ Ajouter</option>${items
        .filter((i) => !selected.includes(i.id))
        .map((i) => `<option value="${i.id}">${prefix}${esc(i.name)}</option>`)
        .join('')}</select>`;
    $('select', container).addEventListener('change', (e) => {
      if (e.target.value) selected.push(e.target.value);
      render();
      onChange?.();
    });
  };
  container.onclick = (e) => {
    const id = e.target.dataset?.id;
    if (!id) return;
    selected.splice(selected.indexOf(id), 1);
    render();
    onChange?.();
  };
  render();
}

// Drag and drop to reorder: grab the ⠿ handle of a row and drop it at its new place.
// Rows are the direct children of container that contain a handle; onMove(old, new) updates the data.
const dragHandle = '<span class="drag-handle" title="Glisser pour déplacer">⠿</span>';
const moveItem = (list, from, to) => list.splice(to, 0, list.splice(from, 1)[0]);

// The grabbed row follows the mouse pixel-perfectly; the others slide smoothly to make room for it.
function dragSort(container, onMove) {
  const EASE = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
  container.onpointerdown = (e) => {
    const grip = e.target.closest('.drag-handle');
    const row = grip && [...container.children].find((c) => c.contains(grip));
    if (e.button !== 0 || !row) return;
    e.preventDefault();
    const rows = () => [...container.children].filter((c) => c.querySelector('.drag-handle'));
    const from = rows().indexOf(row);
    // Position of the row in the page, without the offset applied to it
    let offset = 0;
    const layoutTop = () => row.getBoundingClientRect().top - offset + scrollY;
    const start = { pointer: e.clientY + scrollY, top: layoutTop() };
    let pointerY = e.clientY;
    let frame;

    row.classList.add('dragging');
    document.body.classList.add('sorting');
    row.style.transition = 'box-shadow 0.2s';

    // Moves the row in the list and animates the others from their old place (FLIP technique)
    const reorder = (change) => {
      const others = rows().filter((c) => c !== row);
      const before = new Map(others.map((c) => [c, c.getBoundingClientRect().top]));
      change();
      for (const c of others) {
        c.style.transition = 'none';
        c.style.transform = '';
      }
      for (const c of others) {
        const dy = before.get(c) - c.getBoundingClientRect().top;
        if (!dy) continue;
        c.style.transform = `translateY(${dy}px)`;
        c.getBoundingClientRect(); // applies the starting position before animating
        c.style.transition = EASE;
        c.style.transform = '';
      }
    };

    const follow = () => {
      offset = pointerY + scrollY - start.pointer - (layoutTop() - start.top);
      row.style.transform = `translateY(${offset}px) scale(1.02)`;
    };

    const tick = () => {
      // Auto-scroll, faster near the edge of the screen
      const edge = 80;
      if (pointerY < edge + 64) scrollBy(0, -Math.ceil((edge + 64 - pointerY) / 5));
      else if (pointerY > innerHeight - edge) scrollBy(0, Math.ceil((pointerY - innerHeight + edge) / 5));

      const others = rows().filter((c) => c !== row);
      const next = others.find((c) => {
        const r = c.getBoundingClientRect();
        return pointerY < r.top + r.height / 2;
      });
      if (next) {
        if (row.nextElementSibling !== next) reorder(() => next.before(row));
      } else if (others.length && others.at(-1).nextElementSibling !== row) reorder(() => others.at(-1).after(row));
      follow();
      frame = requestAnimationFrame(tick);
    };

    const move = (ev) => (pointerY = ev.clientY);
    const stop = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', stop);
      removeEventListener('pointercancel', stop);
      cancelAnimationFrame(frame);
      document.body.classList.remove('sorting');
      // The row settles smoothly at its new place, then the list is redrawn
      row.style.transition = `${EASE}, box-shadow 0.2s`;
      row.style.transform = '';
      row.classList.remove('dragging');
      setTimeout(() => {
        rows().forEach((c) => ((c.style.transition = ''), (c.style.transform = '')));
        const to = rows().indexOf(row);
        if (to !== from) onMove(from, to);
      }, 200);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', stop);
    addEventListener('pointercancel', stop);
    frame = requestAnimationFrame(tick);
  };
}

// Simplified Discord markdown: ```block```, `code`, __underline__, **bold**, *italic*, ~~strikethrough~~, links, > quote
function markdown(text) {
  return esc(text)
    .replace(/```(?:\w+\n)?([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .split('\n')
    .map((line) => {
      const html = line
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/__(.+?)__/g, '<u>$1</u>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/~~(.+?)~~/g, '<s>$1</s>')
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      return html.startsWith('&gt; ') ? `<div class="dc-quote">${html.slice(5)}</div>` : `${html}<br>`;
    })
    .join('')
    .replace(/<br>$/, '');
}

// Small SVG charts of the dashboard (statistics, game server players): a single series per chart,
// named by its title. Thin bars with rounded ends, subtle grid, tooltip on hover, table view for accessibility.
// Color: the dashboard accent (--accent in style.css). Texts stay in the text colors, never in the series color.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const H = 180;
  const PAD = { top: 12, right: 8, bottom: 22, left: 34 };
  const fmt = new Intl.NumberFormat('fr-FR');

  // "Round" axis ticks: 0 → rounded max, 4 lines
  function niceMax(max) {
    if (max <= 4) return 4;
    const step = 10 ** Math.floor(Math.log10(max / 4));
    const nice = [1, 2, 2.5, 5, 10].find((m) => m * step * 4 >= max) ?? 10;
    return nice * step * 4;
  }

  function frame(container, title, rows) {
    container.innerHTML = `<div class="chart">
      <div class="chart-head"><h3>${esc(title)}</h3><button type="button" class="chart-toggle" title="Voir les valeurs en tableau">Tableau</button></div>
      <div class="chart-plot"><svg role="img" aria-label="${esc(title)}"></svg><div class="chart-tip" hidden></div></div>
      <div class="chart-table" hidden><table><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>
    </div>`;
    const root = container.firstElementChild;
    $('.chart-toggle', root).addEventListener('click', (e) => {
      const table = $('.chart-table', root);
      table.hidden = !table.hidden;
      $('.chart-plot', root).hidden = !table.hidden;
      e.target.textContent = table.hidden ? 'Tableau' : 'Graphique';
    });
    return root;
  }

  const el = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };

  // Grid and value axis (subtle lines, numbers in secondary text)
  function grid(svg, width, max) {
    const plotH = H - PAD.top - PAD.bottom;
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + plotH - (plotH * i) / 4;
      svg.append(el('line', { x1: PAD.left, x2: width - PAD.right, y1: y, y2: y, class: i ? 'chart-grid' : 'chart-axis' }));
      const label = el('text', { x: PAD.left - 6, y: y + 4, class: 'chart-label', 'text-anchor': 'end' });
      label.textContent = fmt.format(Math.round((max * i) / 4));
      svg.append(label);
    }
  }

  // Tooltip following the mouse (and the finger)
  function tooltip(root, svg, width, count, describe, highlight) {
    const tip = $('.chart-tip', root);
    const plotW = width - PAD.left - PAD.right;
    const move = (e) => {
      const box = svg.getBoundingClientRect();
      const x = ((e.clientX - box.left) / box.width) * width;
      const i = Math.max(0, Math.min(count - 1, Math.floor(((x - PAD.left) / plotW) * count)));
      tip.innerHTML = describe(i);
      tip.hidden = false;
      const left = Math.min(box.width - tip.offsetWidth - 4, Math.max(4, e.clientX - box.left + 12));
      tip.style.left = `${left}px`;
      highlight(i);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', () => {
      tip.hidden = true;
      highlight(-1);
    });
  }

  // data: [{ label, value, tip? }] — labels: only a few labels on the horizontal axis (not one per bar)
  window.barChart = (container, data, { title, unit = '' }) => {
    const root = frame(container, title, data.map((d) => [d.tip ?? d.label, `${fmt.format(d.value)}${unit}`]));
    const svg = $('svg', root);
    const width = Math.max(320, container.clientWidth || 600);
    svg.setAttribute('viewBox', `0 0 ${width} ${H}`);
    const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
    grid(svg, width, max);
    const plotW = width - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const slot = plotW / data.length;
    const gap = Math.min(4, slot * 0.25); // space between bars
    const bars = data.map((d, i) => {
      const h = max ? (d.value / max) * plotH : 0;
      const x = PAD.left + i * slot + gap / 2;
      const w = Math.max(1, slot - gap);
      const r = Math.min(4, w / 2, h);
      const y = PAD.top + plotH - h;
      // Rounded end at the top only, standing on the axis
      const path = h ? `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z` : '';
      const bar = el('path', { d: path, class: 'chart-bar' });
      svg.append(bar);
      return bar;
    });
    const every = Math.ceil(data.length / 8);
    data.forEach((d, i) => {
      if (i % every) return;
      const label = el('text', { x: PAD.left + i * slot + slot / 2, y: H - 6, class: 'chart-label', 'text-anchor': 'middle' });
      label.textContent = d.label;
      svg.append(label);
    });
    tooltip(root, svg, width, data.length, (i) => `<strong>${esc(fmt.format(data[i].value))}${esc(unit)}</strong><span>${esc(data[i].tip ?? data[i].label)}</span>`, (i) =>
      bars.forEach((b, j) => b.classList.toggle('dim', i >= 0 && j !== i)),
    );
  };

  // points: [[date in ms, value or null (no data, e.g. server offline)]]
  window.lineChart = (container, points, { title, from, to, empty = 'Pas encore de données.' }) => {
    const shown = points.filter(([t]) => t >= from && t <= to);
    const time = (t) => new Date(t).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    const root = frame(container, title, shown.map(([t, v]) => [time(t), v === null ? 'hors ligne' : fmt.format(v)]));
    const svg = $('svg', root);
    const width = Math.max(320, container.clientWidth || 600);
    svg.setAttribute('viewBox', `0 0 ${width} ${H}`);
    if (!shown.length) {
      $('.chart-plot', root).innerHTML = `<div class="list-empty">${esc(empty)}</div>`;
      return;
    }
    const max = niceMax(Math.max(0, ...shown.map(([, v]) => v ?? 0)));
    grid(svg, width, max);
    const plotW = width - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const x = (t) => PAD.left + ((t - from) / (to - from)) * plotW;
    const y = (v) => PAD.top + plotH - (v / max) * plotH;
    // The line breaks when the server is offline (null value) instead of dropping to 0
    let d = '';
    let pen = false;
    for (const [t, v] of shown) {
      if (v === null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    }
    svg.append(el('path', { d, class: 'chart-line' }));
    // Time marks: start, middle, end
    for (const t of [from, (from + to) / 2, to]) {
      const label = el('text', { x: x(t), y: H - 6, class: 'chart-label', 'text-anchor': t === from ? 'start' : t === to ? 'end' : 'middle' });
      label.textContent = new Date(t).toLocaleString('fr-FR', to - from > 2 * 86400000 ? { weekday: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit' });
      svg.append(label);
    }
    // Hover: vertical line and dot on the closest value
    const cross = el('line', { y1: PAD.top, y2: PAD.top + plotH, class: 'chart-cross', visibility: 'hidden' });
    const dot = el('circle', { r: 5, class: 'chart-dot', visibility: 'hidden' });
    svg.append(cross, dot);
    const tip = $('.chart-tip', root);
    svg.addEventListener('pointermove', (e) => {
      const box = svg.getBoundingClientRect();
      const t = from + (((e.clientX - box.left) / box.width) * width - PAD.left) / plotW * (to - from);
      const [pt, pv] = shown.reduce((best, p) => (Math.abs(p[0] - t) < Math.abs(best[0] - t) ? p : best));
      cross.setAttribute('x1', x(pt));
      cross.setAttribute('x2', x(pt));
      cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(pt));
      dot.setAttribute('cy', y(pv ?? 0));
      dot.setAttribute('visibility', pv === null ? 'hidden' : 'visible');
      tip.innerHTML = `<strong>${pv === null ? 'Hors ligne' : `${fmt.format(pv)} joueur${pv > 1 ? 's' : ''}`}</strong><span>${esc(time(pt))}</span>`;
      tip.hidden = false;
      tip.style.left = `${Math.min(box.width - tip.offsetWidth - 4, Math.max(4, e.clientX - box.left + 12))}px`;
    });
    svg.addEventListener('pointerleave', () => {
      tip.hidden = true;
      cross.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
    });
  };
})();

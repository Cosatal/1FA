// Color picker: each <span class="color"> (swatch + hex code) gets a ▾ button that opens a palette
// of ready-made colors. Picking a color fills the text field, which already syncs the rest (bindColor, colorField).
(() => {
  const PRESETS = [
    '#5865f2', '#2f7ff0', '#1abc9c', '#3ba55c', '#57f287', '#fee75c',
    '#f5a524', '#e67e22', '#ed4245', '#eb459e', '#9b4dff', '#ffffff',
    '#99aab5', '#2c2f33', '#23272a', '#000000',
  ];
  const t = (text) => (window.tr ? window.tr(text) : text);
  let open = null;

  const close = () => {
    open?.classList.remove('open');
    open = null;
  };

  function enhance(box) {
    if (box.dataset.ready) return;
    const picker = box.querySelector('input[type=color]');
    const text = box.querySelector('input:not([type])');
    if (!picker || !text) return;
    box.dataset.ready = '1';
    text.spellcheck = false;

    const more = Object.assign(document.createElement('button'), { type: 'button', className: 'color-more', title: 'Couleurs toutes prêtes', textContent: '▾' });
    const pop = Object.assign(document.createElement('div'), { className: 'color-pop' });
    pop.innerHTML =
      PRESETS.map((c) => `<button type="button" class="sw" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('') +
      `<button type="button" class="color-custom">🎨 ${t('Autre couleur…')}</button>`;
    box.append(more, pop);

    const choose = (value) => {
      text.value = value;
      text.dispatchEvent(new Event('input', { bubbles: true }));
      picker.value = value;
    };

    more.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wasOpen = open === box;
      close();
      if (wasOpen) return;
      const current = text.value.trim().toLowerCase();
      pop.querySelectorAll('.sw').forEach((b) => b.classList.toggle('active', b.dataset.c === current));
      box.classList.add('open');
      open = box;
    });

    pop.addEventListener('click', (e) => {
      e.preventDefault(); // doesn't open the native picker through the parent <label>
      e.stopPropagation();
      const sw = e.target.closest('.sw');
      if (sw) {
        choose(sw.dataset.c);
        close();
      } else if (e.target.closest('.color-custom')) {
        close();
        try {
          picker.showPicker();
        } catch {
          picker.click();
        }
      }
    });
  }

  document.addEventListener('click', (e) => open && !open.contains(e.target) && close());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());

  const scan = (root) => root.querySelectorAll?.('.color').forEach(enhance);
  scan(document);
  new MutationObserver((mutations) => {
    for (const m of mutations) m.addedNodes.forEach((node) => node.nodeType === 1 && (node.matches('.color') ? enhance(node) : scan(node)));
  }).observe(document.body, { childList: true, subtree: true });
})();

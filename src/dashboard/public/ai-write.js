// "✨ Rédiger" button under each text area marked data-ai="<type>": the AI writes the text, or improves the one already there.
// Text areas added later by scripts also get the button. Relies on common.js (api, toast) and app.js (state).
(() => {
  const t = (text) => (window.tr ? window.tr(text) : text);

  function addButton(area) {
    if (area.dataset.aiReady) return;
    area.dataset.aiReady = '1';
    const bar = Object.assign(document.createElement('div'), { className: 'ai-write' });
    const write = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost small', textContent: '✨ Rédiger avec l’IA' });
    const undo = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost small hidden', textContent: '↩️ Remettre l’ancien texte' });
    bar.append(write, undo);
    area.after(bar);

    let previous = null;
    const setText = (text) => {
      area.value = text;
      area.dispatchEvent(new Event('input', { bubbles: true })); // the forms save the new value
    };

    write.addEventListener('click', async () => {
      const current = area.value.trim();
      const prompt = window.prompt(t(current ? 'Que faut-il changer ? (laisse vide pour simplement l’améliorer)' : 'Que doit dire le texte ? (ex : bienvenue chaleureuse, rappeler les règles)'));
      if (prompt === null || (!current && !prompt.trim())) return;
      write.disabled = true;
      write.textContent = t('⏳ L’IA écrit…');
      try {
        const { text } = await api('POST', `/api/guilds/${state.guildId}/ai/write`, {
          kind: area.dataset.ai,
          prompt,
          current,
          max: area.maxLength > 0 ? area.maxLength : 1000,
        });
        previous = area.value;
        setText(text);
        undo.classList.remove('hidden');
        toast(t('Texte écrit par l’IA ✅ Relis-le avant d’enregistrer.'));
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        write.disabled = false;
        write.textContent = t('✨ Rédiger avec l’IA');
      }
    });

    undo.addEventListener('click', () => {
      if (previous === null) return;
      setText(previous);
      previous = null;
      undo.classList.add('hidden');
    });
  }

  const scan = (root) => root.querySelectorAll?.('textarea[data-ai]').forEach(addButton);
  scan(document);
  new MutationObserver((mutations) => {
    for (const m of mutations) m.addedNodes.forEach((node) => node.nodeType === 1 && (node.matches('textarea[data-ai]') ? addButton(node) : scan(node)));
  }).observe(document.body, { childList: true, subtree: true });
})();

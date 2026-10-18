// Drawing engine of the welcome card, shared between the bot (Node + @napi-rs/canvas)
// and the dashboard editor (browser): the preview is therefore identical to the image sent.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CardRenderer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const W = 1920;
  const H = 1080;

  const SYSTEM_FONTS = [
    'Impact', 'Arial', 'Bahnschrift', 'Segoe UI', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Calibri', 'Franklin Gothic Medium',
    'Georgia', 'Times New Roman', 'Cambria', 'Palatino Linotype', 'Constantia', 'Rockwell', 'Cooper Black', 'Engravers MT',
    'Old English Text MT', 'Algerian', 'Broadway', 'Bauhaus 93', 'Stencil', 'Showcard Gothic', 'Snap ITC', 'Ravie', 'Jokerman',
    'Chiller', 'Magneto', 'Brush Script MT', 'Segoe Script', 'Segoe Print', 'Lucida Handwriting', 'Harlow Solid Italic',
    'Ink Free', 'Gabriola', 'MV Boli', 'Comic Sans MS', 'Courier New', 'Consolas', 'Lucida Console',
  ];

  const text = (id, props) => ({
    id, type: 'text', visible: true, opacity: 1, font: 'Impact', weight: 400, align: 'left', uppercase: true,
    shadow: 12, strokeWidth: 0, strokeColor: '#000000', maxWidth: 620, ...props,
  });

  const DEFAULT_LAYOUT = {
    background: '#14101c',
    overlay: { enabled: true, mode: 'bottom', color: '#0a0514', opacity: 0.85, start: 0.55 },
    elements: [
      { id: 'avatar', type: 'avatar', visible: true, opacity: 1, x: 1090, y: 890, size: 240, shape: 'circle', borderWidth: 10, borderColor: '#9b4dff', glow: 40 },
      text('title', { text: 'BIENVENUE', x: 1255, y: 818, size: 46, color: '#9b4dff' }),
      text('name', { text: '{name}', x: 1255, y: 895, size: 88, color: '#ffffff' }),
      text('subtitle', { text: 'MEMBRE N°{count}', x: 1255, y: 970, size: 38, color: '#e4dcf5' }),
    ],
  };

  const fillVars = (str, vars) => String(str).replace(/\{(user|name|server|count)\}/g, (_, k) => (vars[k] ?? ''));

  function rgba(hex, alpha) {
    const n = parseInt(String(hex).slice(1), 16) || 0;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function shapePath(ctx, shape, cx, cy, r) {
    ctx.beginPath();
    if (shape === 'circle') return ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const rad = shape === 'rounded' ? r * 0.4 : 0;
    const x = cx - r, y = cy - r, s = r * 2;
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + s, y, x + s, y + s, rad);
    ctx.arcTo(x + s, y + s, x, y + s, rad);
    ctx.arcTo(x, y + s, x, y, rad);
    ctx.arcTo(x, y, x + s, y, rad);
    ctx.closePath();
  }

  function drawAvatar(ctx, el, avatar) {
    const r = el.size / 2;
    const outer = r + el.borderWidth;
    if (el.borderWidth > 0 || el.glow > 0) {
      ctx.save();
      ctx.shadowColor = el.borderColor;
      ctx.shadowBlur = el.glow;
      shapePath(ctx, el.shape, el.x, el.y, outer);
      ctx.fillStyle = el.borderColor;
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    shapePath(ctx, el.shape, el.x, el.y, r);
    ctx.clip();
    if (avatar) ctx.drawImage(avatar, el.x - r, el.y - r, r * 2, r * 2);
    else {
      ctx.fillStyle = '#5865f2';
      ctx.fillRect(el.x - r, el.y - r, r * 2, r * 2);
    }
    ctx.restore();
    return { x: el.x - outer, y: el.y - outer, w: outer * 2, h: outer * 2 };
  }

  function drawText(ctx, el, vars, translate) {
    let content = fillVars(translate(el.text), vars);
    if (el.uppercase) content = content.toUpperCase();
    const font = (size) => `${el.weight} ${size}px "${el.font}", Impact, sans-serif`;

    // Too long: the font shrinks (down to 60%), then the text is cut with …
    let size = el.size;
    ctx.font = font(size);
    if (el.maxWidth > 0) {
      while (size > el.size * 0.6 && ctx.measureText(content).width > el.maxWidth) ctx.font = font((size -= 2));
      if (ctx.measureText(content).width > el.maxWidth) {
        while (content.length > 1 && ctx.measureText(`${content}…`).width > el.maxWidth) content = content.slice(0, -1);
        content += '…';
      }
    }

    ctx.textAlign = el.align;
    ctx.textBaseline = 'middle';
    if (el.strokeWidth > 0) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = el.strokeWidth * 2;
      ctx.strokeStyle = el.strokeColor;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = el.shadow;
      ctx.strokeText(content, el.x, el.y);
      ctx.shadowBlur = 0;
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = el.shadow;
    }
    ctx.fillStyle = el.color;
    ctx.fillText(content, el.x, el.y);

    const w = Math.max(ctx.measureText(content).width, 20) + el.strokeWidth * 2;
    const left = el.align === 'center' ? el.x - w / 2 : el.align === 'right' ? el.x - w : el.x;
    return { x: left, y: el.y - size * 0.6, w, h: size * 1.2 };
  }

  function drawOverlay(ctx, o) {
    if (!o.enabled) return;
    if (o.mode === 'full') {
      ctx.fillStyle = rgba(o.color, o.opacity);
      return ctx.fillRect(0, 0, W, H);
    }
    // start = where the gradient begins (0 = opposite edge, 1 = nothing)
    const s = o.start;
    const g = {
      bottom: () => ctx.createLinearGradient(0, H * s, 0, H),
      top: () => ctx.createLinearGradient(0, H * (1 - s), 0, 0),
      right: () => ctx.createLinearGradient(W * s, 0, W, 0),
      left: () => ctx.createLinearGradient(W * (1 - s), 0, 0, 0),
    }[o.mode]();
    g.addColorStop(0, rgba(o.color, 0));
    g.addColorStop(1, rgba(o.color, o.opacity));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Draws the whole card. Returns the area taken by each element (used to select them in the editor).
  // translate: applied to each text before the variables are filled (default texts follow the server language)
  function drawCard(ctx, layout, assets, vars, translate = (t) => t) {
    const boxes = {};
    ctx.save();
    ctx.fillStyle = layout.background;
    ctx.fillRect(0, 0, W, H);
    const { banner, avatar } = assets;
    if (banner) {
      const scale = Math.max(W / banner.width, H / banner.height);
      ctx.drawImage(banner, (W - banner.width * scale) / 2, (H - banner.height * scale) / 2, banner.width * scale, banner.height * scale);
    }
    drawOverlay(ctx, layout.overlay);
    for (const el of layout.elements) {
      if (!el.visible) continue;
      ctx.save();
      ctx.globalAlpha = el.opacity;
      boxes[el.id] = el.type === 'avatar' ? drawAvatar(ctx, el, avatar) : drawText(ctx, el, vars, translate);
      ctx.restore();
    }
    ctx.restore();
    return boxes;
  }

  return { W, H, SYSTEM_FONTS, DEFAULT_LAYOUT, newText: text, drawCard, fillVars };
});

const fs = require('node:fs');
const path = require('node:path');
const { GlobalFonts } = require('@napi-rs/canvas');
const { DATA_DIR } = require('./store');

// Fonts uploaded from the dashboard: data/fonts/<Name>.ttf|otf (file name = font name)
const FONTS_DIR = path.join(DATA_DIR, 'fonts');

function listFonts() {
  try {
    return fs
      .readdirSync(FONTS_DIR)
      .filter((file) => /\.(ttf|otf)$/i.test(file))
      .map((file) => ({ family: path.parse(file).name, file }));
  } catch {
    return [];
  }
}

function registerAll() {
  for (const { family, file } of listFonts()) GlobalFonts.registerFromPath(path.join(FONTS_DIR, file), family);
}

// Registers a new font. Returns null if the file isn't a valid font
function addFont(name, buffer) {
  const magic = buffer.subarray(0, 4).toString('latin1');
  const ext = magic === 'OTTO' ? 'otf' : magic === '\0\x01\0\0' || magic === 'true' ? 'ttf' : null;
  if (!ext) return null;

  const family = name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40) || 'Police';
  // Fonts are shared by all servers: never replace another server's font
  if (listFonts().some((f) => f.family.toLowerCase() === family.toLowerCase())) throw new Error(`Une police « ${family} » existe déjà : choisis un autre nom.`);
  const file = `${family}.${ext}`;
  const full = path.join(FONTS_DIR, file);
  fs.mkdirSync(FONTS_DIR, { recursive: true });
  fs.writeFileSync(full, buffer);
  if (!GlobalFonts.registerFromPath(full, family)) {
    fs.rmSync(full, { force: true });
    return null;
  }
  return { family, file };
}

// The font stays loaded until the next restart, but is no longer offered
function removeFont(family) {
  const font = listFonts().find((f) => f.family === family);
  if (font) fs.rmSync(path.join(FONTS_DIR, font.file), { force: true });
  return Boolean(font);
}

module.exports = { FONTS_DIR, listFonts, registerAll, addFont, removeFont };

// Bot data storage: JSON files in data/ (no database to install).
// Almost every module goes through createStore: one config per server, kept in memory and written to disk
// shortly after each change. get() returns a copy you can modify, peek() a fast read that must not be modified.
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// Writes to a temporary file then renames it: a crash while writing can't corrupt the data
function writeJson(file, value, pretty = true) {
  const json = JSON.stringify(value, null, pretty ? 2 : 0);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(`${file}.tmp`, json);
    fs.renameSync(`${file}.tmp`, file);
  } catch {
    // On Windows, renaming can fail if another program has the file open
    fs.writeFileSync(file, json);
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    // Damaged file: set it aside instead of overwriting it on the next save
    if (error.code !== 'ENOENT') {
      try {
        fs.renameSync(file, `${file}.broken-${Date.now()}`);
      } catch {}
      console.error(`${path.basename(file)} unreadable, set aside:`, error.message);
    }
    return fallback;
  }
}

// Modified files not written yet: a single save for several close changes
// (one file holds every server: rewriting it on every click would be costly). Everything is written before the bot stops.
const pending = new Map(); // file → () => write
let timer = null;
function flushStores() {
  clearTimeout(timer);
  timer = null;
  for (const write of pending.values()) write();
  pending.clear();
}
function scheduleWrite(file, write) {
  pending.set(file, write);
  timer ??= setTimeout(flushStores, 1000);
}
process.on('exit', flushStores);

// Small per-server JSON storage: data/<name>.json = { <guildId>: config }
// The file is read only once then kept in memory: editing the JSON by hand requires restarting the bot
function createStore(name, defaults) {
  const file = path.join(DATA_DIR, `${name}.json`);
  let cache = null;
  const all = () => (cache ??= readJson(file, {}));
  const write = () => writeJson(file, cache);

  return {
    // Deep copy: modifying the returned config touches neither the cache nor the default values
    get: (guildId) => structuredClone({ ...defaults, ...all()[guildId] }),
    // Read-only, no copy (for frequent reads: on every message, reaction…). Never modify the result
    peek: (guildId) => ({ ...defaults, ...all()[guildId] }),
    save(guildId, config) {
      all()[guildId] = structuredClone(config);
      scheduleWrite(file, write);
    },
    delete(guildId) {
      if (!(guildId in all())) return;
      delete cache[guildId];
      scheduleWrite(file, write);
    },
  };
}

module.exports = { createStore, readJson, writeJson, flushStores, DATA_DIR };

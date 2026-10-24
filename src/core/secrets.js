// Encryption of the secrets saved in data/ (AI keys, Twitch secret, RCON passwords): AES-256-GCM with the ENCRYPTION_KEY
// of the .env (64 hex characters). Someone who gets the data/ folder alone (a backup, a copied VPS disk) can't read them.
// Saved form: "enc:v1:<iv>:<tag>:<data>" (base64). Values saved before encryption existed are read as they are,
// then encrypted on the next startup (encryptStored… in settings.js and feature-config.js).
// Without ENCRYPTION_KEY, secrets are saved in clear text and a warning is shown in the console.
const crypto = require('node:crypto');

const PREFIX = 'enc:v1:';
const raw = process.env.ENCRYPTION_KEY?.trim() ?? '';
// 64 hex characters = 32 bytes; any other text is turned into a 32-byte key (SHA-256)
const KEY = !raw ? null : /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : crypto.createHash('sha256').update(raw).digest();

if (!KEY) {
  console.warn('ENCRYPTION_KEY missing in .env: AI keys and passwords are saved in clear text in data/. '
    + `Add for example: ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}`);
}

const isEncrypted = (value) => typeof value === 'string' && value.startsWith(PREFIX);

function encryptSecret(value) {
  if (!KEY || typeof value !== 'string' || !value || isEncrypted(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

// A secret that can't be read (key missing or changed) is treated as empty: it has to be entered again
let warned = false;
function decryptSecret(value) {
  if (!isEncrypted(value)) return value ?? '';
  try {
    if (!KEY) throw new Error('ENCRYPTION_KEY missing');
    const [iv, tag, data] = value.slice(PREFIX.length).split(':').map((part) => Buffer.from(part, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (error) {
    if (!warned) console.error(`Unable to decrypt a saved secret (${error.message}): check ENCRYPTION_KEY in .env.`);
    warned = true;
    return '';
  }
}

module.exports = { encryptSecret, decryptSecret, isEncrypted, encryptionEnabled: Boolean(KEY) };

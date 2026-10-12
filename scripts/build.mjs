// Encrypts data.js into per-account files under data/. Run from anywhere: node scripts/build.mjs
import { webcrypto as crypto } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/", ROOT);
const SECRETS_PATH = new URL("secrets.json", ROOT);
const ITERATIONS = 600000;
const OPEN_FIELDS = ["id", "name", "role", "player", "initials", "who", "knows", "life", "past", "quirks"];
const SEALED_FIELDS = ["secret", "goalMain", "goalExtra", "goalMini", "abilityName", "abilityText"];
const CHARSET = "abcdefghjkmnpqrstuvwxyz23456789";

// Must match normalizeKey in auth.js.
const normalizeKey = s => String(s).toLowerCase().replace(/[\s-]+/g, "");
const b64 = bytes => Buffer.from(bytes).toString("base64");
const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, typeof obj[k] === "string" ? obj[k] : ""]));

function randomCode(groups) {
  const limit = CHARSET.length * Math.floor(256 / CHARSET.length);
  const buf = new Uint8Array(1);
  const parts = [];
  for (let g = 0; g < groups; g++) {
    let part = "";
    while (part.length < 4) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) part += CHARSET[buf[0] % CHARSET.length];
    }
    parts.push(part);
  }
  return parts.join("-");
}

async function encrypt(value, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(normalizeKey(secret)), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iter: ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

const asScript = (target, value) => `${target} = ${JSON.stringify(value).replace(/</g, "\\u003c")};\n`;

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(new URL("data.js", ROOT), "utf8"), sandbox);
const data = sandbox.window.BLACKTHORN_DATA;
const characters = data.characters.characters;

const secrets = existsSync(SECRETS_PATH) ? JSON.parse(readFileSync(SECRETS_PATH, "utf8")) : {};
secrets.admin = secrets.admin || randomCode(4);
secrets.characters = secrets.characters || {};

for (const c of characters) {
  if (!/^[a-z0-9_-]+$/i.test(c.id) || c.id === "admin") throw new Error(`Invalid character id: "${c.id}"`);
  const s = secrets.characters[c.id] = secrets.characters[c.id] || {};
  s.password = s.password || randomCode(3);
  s.seal = s.seal || randomCode(3);
}
writeFileSync(SECRETS_PATH, JSON.stringify(secrets, null, 2) + "\n");

rmSync(new URL("chars/", OUT), { recursive: true, force: true });
mkdirSync(new URL("chars/", OUT), { recursive: true });

writeFileSync(new URL("public.js", OUT), asScript("window.BLACKTHORN_PUBLIC", {
  invitation: data.invitation,
  accounts: characters.map(c => ({ id: c.id, name: c.name }))
}));

for (const c of characters) {
  const s = secrets.characters[c.id];
  const sealed = pick(c, SEALED_FIELDS);
  const hasSealed = SEALED_FIELDS.some(f => sealed[f].trim());
  const box = {
    open: await encrypt(pick(c, OPEN_FIELDS), s.password),
    sealed: hasSealed ? await encrypt(sealed, s.seal) : null
  };
  writeFileSync(new URL(`chars/${c.id}.js`, OUT),
    asScript(`(window.BLACKTHORN_ENC = window.BLACKTHORN_ENC || {})[${JSON.stringify(c.id)}]`, box));
}

const seals = Object.fromEntries(characters.map(c => [c.id, secrets.characters[c.id].seal]));
writeFileSync(new URL("admin.js", OUT), asScript("(window.BLACKTHORN_ENC = window.BLACKTHORN_ENC || {}).admin",
  await encrypt({ characters: data.characters, host: data.host, seals }, secrets.admin)));

console.log(`Encrypted ${characters.length} characters + admin into data/. Passwords and seal codes: secrets.json`);

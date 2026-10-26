// Encrypts data.js into per-account files under data/. Run from anywhere: node scripts/build.mjs
import { webcrypto as crypto } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/", ROOT);
const SECRETS_PATH = new URL("secrets.json", ROOT);
const ITERATIONS = 600000;
const OPEN_FIELDS = ["id", "name", "role", "player", "initials", "who", "life", "past", "quirks"];
const SEALED_FIELDS = ["knows", "secret", "goalMain", "goalExtra", "goalMini", "abilityName", "abilityText"];
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

// A fingerprint of a password, so the site can tell whose password it is without asking for the name.
// Same PBKDF2 cost as the encrypted files, so it is no easier to guess a password from it.
async function loginTag(secret, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(normalizeKey(secret)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, base, 128);
  return b64(bits);
}

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(new URL("data.js", ROOT), "utf8"), sandbox);
const data = sandbox.window.BLACKTHORN_DATA;
const characters = data.characters.characters;

const guestNotes = data.guests?.notes || {};
const guestList = (data.guests?.list || []).map(g => {
  const c = characters.find(x => x.id === g.id) || {};
  return {
    id: g.id,
    name: g.name || c.name || "",
    player: g.player ?? c.player ?? "",
    initials: g.initials || c.initials || "",
    short: g.short || "",
    portrait: g.portrait || "",
    victim: !!g.victim
  };
});

const secrets = existsSync(SECRETS_PATH) ? JSON.parse(readFileSync(SECRETS_PATH, "utf8")) : {};
secrets.admin = secrets.admin || randomCode(4);
secrets.characters = secrets.characters || {};

for (const c of characters) {
  if (!/^[a-z0-9_-]+$/i.test(c.id) || c.id === "admin") throw new Error(`Invalid character id: "${c.id}"`);
  const s = secrets.characters[c.id] = secrets.characters[c.id] || {};
  s.password = s.password || randomCode(3);
  s.seal = s.seal || randomCode(3);
}

const voting = secrets.voting = secrets.voting || {};
voting.code = voting.code || randomCode(2);
voting.verdictCode = voting.verdictCode || randomCode(2);
voting.telegramToken = String(voting.telegramToken || "").trim();
voting.telegramChatId = String(voting.telegramChatId || "").trim();
if (voting.telegramToken && !voting.telegramChatId) voting.telegramChatId = await findTelegramChat(voting.telegramToken);
writeFileSync(SECRETS_PATH, JSON.stringify(secrets, null, 2) + "\n");

// The chat id is taken from the latest private message to the bot (the host sends it /start once).
async function findTelegramChat(token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || res.status);
    const chat = json.result.map(u => u.message?.chat).filter(c => c && c.type === "private").pop();
    if (chat) {
      console.log(`Telegram: ballots will go to ${[chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || chat.id}.`);
      return String(chat.id);
    }
    console.warn("Telegram: no messages to the bot yet. Send your bot /start in Telegram, then run the build again.");
  } catch (e) {
    console.warn(`Telegram: could not read the bot's messages (${e.message}). Check voting.telegramToken in secrets.json.`);
  }
  return "";
}

rmSync(new URL("chars/", OUT), { recursive: true, force: true });
mkdirSync(new URL("chars/", OUT), { recursive: true });

const telegram = voting.telegramToken && voting.telegramChatId ? { token: voting.telegramToken, chatId: voting.telegramChatId } : null;
const ballot = data.voting && Array.isArray(data.voting.nominations) ? {
  title: data.voting.title || "",
  intro: data.voting.intro || "",
  nominations: data.voting.nominations.map(n => ({ icon: n.icon || "", title: n.title || "", desc: n.desc || "" })),
  telegram
} : null;
const verdict = data.verdict ? {
  ...pick(data.verdict, ["title", "intro", "suspect", "accomplice", "story", "storyHint"]),
  telegram
} : null;

const loginSalt = crypto.getRandomValues(new Uint8Array(16));
const loginTags = {};
for (const [account, password] of [["admin", secrets.admin], ...characters.map(c => [c.id, secrets.characters[c.id].password])]) {
  const tag = await loginTag(password, loginSalt);
  if (loginTags[tag]) throw new Error(`"${account}" and "${loginTags[tag]}" have the same password in secrets.json. Every password must be different.`);
  loginTags[tag] = account;
}

writeFileSync(new URL("public.js", OUT), asScript("window.BLACKTHORN_PUBLIC", {
  build: Date.now().toString(36),
  invitation: data.invitation,
  accounts: characters.map(c => ({ id: c.id, name: c.name })),
  login: { iter: ITERATIONS, salt: b64(loginSalt), tags: loginTags },
  voting: ballot ? await encrypt(ballot, voting.code) : null,
  verdict: verdict ? await encrypt(verdict, voting.verdictCode) : null
}));

for (const c of characters) {
  const s = secrets.characters[c.id];
  const sealed = pick(c, SEALED_FIELDS);
  const hasSealed = SEALED_FIELDS.some(f => sealed[f].trim());
  const box = {
    open: await encrypt({ ...pick(c, OPEN_FIELDS), guests: { list: guestList, notes: guestNotes[c.id] || {} } }, s.password),
    sealed: hasSealed ? await encrypt(sealed, s.seal) : null
  };
  writeFileSync(new URL(`chars/${c.id}.js`, OUT),
    asScript(`(window.BLACKTHORN_ENC = window.BLACKTHORN_ENC || {})[${JSON.stringify(c.id)}]`, box));
}

const seals = Object.fromEntries(characters.map(c => [c.id, secrets.characters[c.id].seal]));
writeFileSync(new URL("admin.js", OUT), asScript("(window.BLACKTHORN_ENC = window.BLACKTHORN_ENC || {}).admin",
  await encrypt({ characters: data.characters, host: data.host, seals, guests: { list: guestList, notes: guestNotes },
    voting: ballot ? { ...ballot, code: voting.code } : null,
    verdict: verdict ? { ...verdict, code: voting.verdictCode } : null }, secrets.admin)));

console.log(`Encrypted ${characters.length} characters + admin into data/. Passwords and seal codes: secrets.json`);
const pickable = guestList.filter(g => !g.victim).length - 1;
if (!ballot) console.warn("Voting: data.js has no \"voting\" block, so the «Запечатаний лист» tab will be empty.");
else if (ballot.nominations.length > pickable)
  console.warn(`Voting: ${ballot.nominations.length} nominations, but each guest can pick only ${pickable} different people. Remove some nominations.`);
if (!verdict) console.warn("Verdict: data.js has no \"verdict\" block, so the «Чорний конверт» tab will be empty.");
if (ballot || verdict) {
  if (!telegram) console.warn("Telegram is not set up, answers can't be sent. See README → Голосування.");
  else console.log(`Telegram: on. Verdict code: ${voting.verdictCode}. Voting code: ${voting.code}.`);
}

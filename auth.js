(() => {
  const SESSION_KEY = "blackthorn-dossier-session";
  const SEALED_FIELDS = ["knows", "secret", "goalMain", "goalExtra", "goalMini", "abilityName", "abilityText"];
  const pub = window.BLACKTHORN_PUBLIC;
  const form = document.querySelector("#login-form");
  const accountSelect = document.querySelector("#login-account");
  const passwordInput = document.querySelector("#login-password");
  const error = document.querySelector("#login-error");
  const sessionActions = document.querySelector("#session-actions");
  const sessionName = document.querySelector("#session-name");

  if (!form) return;
  if (!pub) {
    error.textContent = "Дані досьє не знайдено. Запустіть node scripts/build.mjs.";
    return;
  }
  if (!window.crypto || !crypto.subtle) {
    error.textContent = "Браузер не підтримує розшифрування. Відкрийте сторінку через https.";
    return;
  }

  let session = null;

  // Must match normalizeKey in scripts/build.mjs.
  const normalizeKey = s => String(s).toLowerCase().replace(/[\s-]+/g, "");
  const fromB64 = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
  const isKnown = account => account === "admin" || pub.accounts.some(a => a.id === account);

  async function decrypt(box, secret) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(normalizeKey(secret)), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: fromB64(box.salt), iterations: box.iter, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(box.iv) }, key, fromB64(box.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => { script.remove(); resolve(); };
      script.onerror = () => { script.remove(); reject(new Error("Failed to load " + src)); };
      document.head.appendChild(script);
    });
  }

  async function loadBox(account) {
    const store = window.BLACKTHORN_ENC = window.BLACKTHORN_ENC || {};
    if (!store[account]) {
      await loadScript(account === "admin" ? "data/admin.js" : `data/chars/${encodeURIComponent(account)}.js`);
    }
    if (!store[account]) throw new Error("Missing data for " + account);
    return store[account];
  }

  async function signIn(account, box, password) {
    if (account === "admin") {
      const d = await decrypt(box, password);
      return { account, role: "admin", characters: d.characters, host: d.host, seals: d.seals || {} };
    }
    const character = await decrypt(box.open, password);
    return { account, role: "player", character, sealedBox: box.sealed, unsealed: !box.sealed };
  }

  function pageData(s) {
    if (s.role === "admin") {
      return { role: "admin", characters: s.characters, host: s.host, invitation: pub.invitation, seals: s.seals };
    }
    return {
      role: "player",
      characters: { characters: [s.character] },
      host: { sections: [] },
      invitation: pub.invitation,
      sealedIds: s.unsealed ? [] : [s.account]
    };
  }

  function saveSession() {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (ignored) {}
  }

  function start(s) {
    session = s;
    saveSession();
    window.BLACKTHORN_DATA = pageData(s);
    window.initCards();
    window.initHost();
    window.initInvite();
    activate(s.account);
  }

  function addOption(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    accountSelect.appendChild(option);
  }

  function populateAccounts() {
    addOption("admin", "Ведуча / адміністратор");
    pub.accounts.forEach(a => addOption(a.id, a.name));
  }

  function accountName(account) {
    if (account === "admin") return "Ведуча";
    return pub.accounts.find(a => a.id === account)?.name || "Персонаж";
  }

  function showCharacterOnly(characterId) {
    document.body.dataset.character = characterId;
    document.querySelectorAll("#cards .card").forEach(card => {
      card.hidden = card.dataset.id !== characterId;
    });
    document.querySelector('[data-view="host"]').hidden = true;
  }

  function selectView(view) {
    const tab = document.querySelector(`.view-tab[data-view="${view}"]`);
    if (tab) tab.click();
  }

  function activate(account) {
    const isAdmin = account === "admin";
    document.body.classList.remove("access-locked");
    document.body.classList.toggle("admin-mode", isAdmin);
    document.body.classList.toggle("character-mode", !isAdmin);
    sessionActions.hidden = false;
    sessionName.textContent = isAdmin ? "Режим ведучої" : accountName(account);

    if (isAdmin) {
      document.querySelectorAll("#cards .card").forEach(card => { card.hidden = false; });
      document.querySelector('[data-view="host"]').hidden = false;
      selectView("cards");
    } else {
      showCharacterOnly(account);
      selectView("invite");
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const account = accountSelect.value;
    if (!isKnown(account)) return;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    error.textContent = "";

    let s;
    try {
      const box = await loadBox(account);
      try {
        s = await signIn(account, box, passwordInput.value);
      } catch (wrongPassword) {
        error.textContent = "Невірний пароль.";
        passwordInput.select();
        return;
      }
    } catch (loadError) {
      error.textContent = "Не вдалося завантажити досьє. Перевірте з'єднання й спробуйте ще раз.";
      return;
    } finally {
      submit.disabled = false;
    }

    passwordInput.value = "";
    start(s);
  });

  document.querySelector("#cards").addEventListener("submit", async event => {
    const unsealForm = event.target.closest(".unseal-form");
    if (!unsealForm) return;
    event.preventDefault();
    if (!session || session.role !== "player" || !session.sealedBox) return;

    const input = unsealForm.elements.code;
    const message = unsealForm.querySelector(".unseal-error");
    const button = unsealForm.querySelector('[type="submit"]');
    button.disabled = true;
    message.textContent = "";

    let sealed;
    try {
      sealed = await decrypt(session.sealedBox, input.value);
    } catch (wrongCode) {
      message.textContent = "Невірний код печатки.";
      input.select();
      return;
    } finally {
      button.disabled = false;
    }

    SEALED_FIELDS.forEach(f => { session.character[f] = typeof sealed[f] === "string" ? sealed[f] : ""; });
    session.unsealed = true;
    saveSession();
    window.BlackthornCards.unseal(session.account, sealed);
  });

  document.querySelector("#logout").addEventListener("click", () => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (ignored) {}
    window.location.hash = "";
    window.location.reload();
  });

  populateAccounts();

  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (ignored) {}
  if (saved && isKnown(saved.account) && saved.role === (saved.account === "admin" ? "admin" : "player")) start(saved);
})();

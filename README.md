# The Blackthorn Mystery

Static GitHub Pages version of the character dossier.

## Publish with GitHub Pages

1. Create a GitHub repository and upload every file in this folder.
2. In GitHub, open **Settings > Pages**.
3. Select **Deploy from a branch**, choose `main` and `/ (root)`, then save.
4. Open the URL shown by GitHub Pages. `index.html` redirects to the dossier.

## Build the encrypted data

`data.js` holds the plain text of everything and is **not** published (see `.gitignore`). Before every deploy run:

```
node scripts/build.mjs
```

(Node 18+.) This writes:

- `data/public.js`: the invitation, the character names, password fingerprints for the login page (see below), and the two sealed voting envelopes.
- `data/chars/<id>.js`: each character, in two encrypted parts. "Хто це", "Що знає" and "Минуле" open with that player's password. "Секрет", the goals and "Особливість" open with that character's seal code.
- `data/admin.js`: everything, plus all seal codes, encrypted with the admin password.

Passwords and seal codes live in `secrets.json`. On the first run the script generates any that are missing. Never commit that file. Commit the `data/` folder together with the HTML, CSS and JS.

## Accounts

- Everyone, including the host, logs in with just a password: there is no list of names. The site works out whose password it is from a fingerprint in `data/public.js`, made with the same slow PBKDF2 hashing as the encrypted files. Every password must be different; the build stops if two are the same.
- Players see only the open part of their card.
- When it's time, the host gives a player their seal code (shown on each card in admin mode). The player types it in under "Під печаткою" to open the rest.
- Passwords and codes ignore case, spaces and dashes.

To change a password, edit `secrets.json` and run the build again.

The page loads `styles.css`, `auth.js` and `data/public.js` with a `?v=` number so phones don't keep an old copy. If you change those files' structure, raise the number in `blackthorn-mystery.html`.

## Голосування (voting)

There are two sealed tabs. Until their code is entered, each shows only a neutral name, heading and sealed screen, with no mention of voting. Each is encrypted with its own code, so nobody can open it before the host announces that code. Answers are signed with the guest's character and player name and sent to the host's Telegram. The host sees both codes on the tabs.

- **"Чорний конверт"** is the verdict (the `verdict` block in `data.js`, code `voting.verdictCode`). Before the new will is opened, each guest names the murderer, optionally an accomplice, and explains how and why it happened.
- **"Запечатаний лист"** is the ballot for the evening's nominations (the `voting` block in `data.js`, code `voting.code`). At the end of the evening each guest picks a different character for every nomination.

Set up the Telegram bot once:

1. In Telegram, open **@BotFather**, send `/newbot` and follow the steps. Copy the token it gives you.
2. Open your new bot and press **Start**.
3. In `secrets.json`, put the token into `voting.telegramToken` and leave `voting.telegramChatId` empty. (If there is no `voting` block yet, run the build once and it will be created.)
4. Run `node scripts/build.mjs`. It finds your private chat with the bot (the chat the answers are sent to) and fills in `telegramChatId`.
5. Log in as the host, open each tab and send a test answer.

To change a code, edit `voting.verdictCode` or `voting.code` and run the build again.

## Security notes

- Players only download their own encrypted file, and nothing in the published files is plain text except the invitation and the character names.
- The encrypted files are public, so anyone can try to guess passwords offline. Keep the generated passwords, or use equally long random ones.
- After logging in, decrypted data is kept in that tab's `sessionStorage` until the tab is closed or the user logs out. Admin edits are saved in that browser's `localStorage`. Log out on shared devices.
- The Telegram bot token is inside the voting ballot. Once the voting code is announced, a guest who digs into the page could find the token and send messages through the bot. After the party, revoke the token in @BotFather (`/revoke`).
- If `data.js` or old passwords were ever pushed to git, they stay in the history. Use new passwords, and rewrite the history or create a fresh repository.

## Editing and backups

Card and invitation edits made in admin mode are saved only in that browser's local storage. The three host tabs are read-only and always show the text from `data.js`. To make a change permanent, edit `data.js`, then run the build and redeploy.

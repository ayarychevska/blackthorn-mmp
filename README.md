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

- `data/public.js`: the invitation and the character names for the login list.
- `data/chars/<id>.js`: each character, in two encrypted parts. "Хто це", "Що знає" and "Минуле" open with that player's password. "Секрет", the goals and "Особливість" open with that character's seal code.
- `data/admin.js`: everything, plus all seal codes, encrypted with the admin password.

Passwords and seal codes live in `secrets.json`. On the first run the script generates any that are missing. Never commit that file. Commit the `data/` folder together with the HTML, CSS and JS.

## Accounts

- Players log in with their own password and see only the open part of their card.
- When it's time, the host gives a player their seal code (shown on each card in admin mode). The player types it in under "Під печаткою" to open the rest.
- Passwords and codes ignore case, spaces and dashes.

To change a password, edit `secrets.json` and run the build again.

## Security notes

- Players only download their own encrypted file, and nothing in the published files is plain text except the invitation and the character names.
- The encrypted files are public, so anyone can try to guess passwords offline. Keep the generated passwords, or use equally long random ones.
- After logging in, decrypted data is kept in that tab's `sessionStorage` until the tab is closed or the user logs out. Admin edits are saved in that browser's `localStorage`. Log out on shared devices.
- If `data.js` or old passwords were ever pushed to git, they stay in the history. Use new passwords, and rewrite the history or create a fresh repository.

## Editing and backups

Card and invitation edits made in admin mode are saved only in that browser's local storage. The three host tabs are read-only and always show the text from `data.js`. To make a change permanent, edit `data.js`, then run the build and redeploy.

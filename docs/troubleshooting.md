# Troubleshooting

Organized by **symptom**. Each entry lists the most likely cause first.

## Installation

### `better-sqlite3` fails to build

You're missing native build tools.

- **Debian/Ubuntu:** `sudo apt install build-essential python3`
- **macOS:** `xcode-select --install`
- **Windows:** use WSL, or install Visual Studio Build Tools.

Then re-run `npm install` from `backend/`.

---

## CLI

### `Error: Either --domain or --all must be provided`

You forgot to tell the CLI what to download. Either:

```bash
... --domain example.com
... --all          # everything already known to the DB
```

### `Either --max-req-per-second or --max-req-per-minute must be provided`

The CLI refuses to download without a rate limit. Add one:

```bash
--max-req-per-second 1
```

(`--dry-run` skips this check.)

### Downloads stall at "pending"

Common causes, in order:

1. **No internet / DNS blocked**: try `curl -I https://web.archive.org/`.
2. **Proxies all dead**: try without `--proxy-file` first.
3. **Rate-limited by IA**: lower `--max-req-per-second` (try `0.5`).
4. **Too many concurrent requests**: lower `--concurrency`.

### Many `ETIMEDOUT` errors

Either the proxies are slow or IA is throttling you. Drop the rate, then
retry with `--skip-cdx-sync`.

### `Error: SQLITE_BUSY`

Another process has the DB locked. Make sure only one of: CLI, admin
server, replay server, is writing at once. (Reading is fine because of
WAL mode.) Stop the CLI before running it again.

---

## Admin server

### `Admin server listening on http://localhost:5050` but the frontend shows "Failed to fetch"

1. Open `http://localhost:5050/api/domains/` directly — does it respond?
2. If yes, the frontend's `BACKEND_URL` is wrong. Default expectations:
   frontend on `:3000`, admin on `:5050`.
3. Check `frontend/next.config.ts` — the rewrites must point to your admin
   URL.

### Search starts but never finishes

The search worker pool might be stuck.

1. Stop the admin server (`Ctrl+C`).
2. Restart with fewer workers, e.g. `-w 4`.
3. Try the search again on a smaller domain subset.

### `EADDRINUSE :::5050`

Another process is on port 5050. Find and kill it:

```bash
lsof -iTCP:5050 -sTCP:LISTEN
```

---

## Replay server

### Archived page loads but **all CSS/JS/images are broken**

The Chrome extension is not active.

1. `chrome://extensions` → confirm **Wayback Request Logger** is enabled.
2. If recently changed, click the **reload** icon on its card.
3. Reload the replay page.

### Replay page returns 404

The resource isn't in your data folder. Either:

- It was never downloaded — re-run the CLI for that domain.
- The admin and replay servers are pointing at **different data folders**.
  Confirm both use the same `--data-folder`.

### Right-click menu missing on replay page

You're not on a `http://localhost:5051/replay/...` URL, or the extension
is disabled.

### Mixed content / HTTPS upgrade

Replay only works over plain `http://localhost:5051`. If your browser
auto-upgrades to HTTPS, disable HTTPS-only mode for `localhost` or use a
different browser profile.

---

## Chrome extension

### Extension card says "Errors"

1. Click the **Errors** button on the extension card to see details.
2. Most commonly: Chrome MV3 declarativeNetRequest rule conflicts. Reload
   the extension after pulling a new version.

### Service worker stops

Chrome may unload the MV3 service worker if it's been idle. The next
request from a localhost tab will wake it up automatically — usually no
action needed.

### I can't load the extension folder

You probably selected the wrong directory. Pick `extension/chrome/` (the
folder containing `manifest.json`), not the repo root.

---

## Frontend

### Page is blank, dev tools show "ECONNREFUSED localhost:5050"

The admin server isn't running. Start it.

### "Hydration mismatch" warnings during `npm run dev`

Harmless in development — pages still work. They go away after `npm run
build`.

### Replay links open the wrong replay URL

`NEXT_PUBLIC_REPLAY_SERVER_URL` is baked at build time. Set it and rebuild:

```bash
NEXT_PUBLIC_REPLAY_SERVER_URL=http://localhost:5051 npm run build
```

---

## Data folder

### "I changed my data folder; the old data seems gone"

The frontend, admin and replay servers each read from whatever
`--data-folder` you passed at startup. Restart them with the correct path.

### "Schema is older than expected"

Migrations are applied automatically on `openDatabase`. If you see schema
errors, ensure you've pulled the latest repo and that `backend/src/db/migrations/`
isn't truncated.

---

## Still stuck?

- Read the relevant component doc again: [CLI](cli.md),
  [admin](admin-server.md), [replay](replay-server.md),
  [extension](chrome-extension.md), [frontend](frontend.md).
- Re-run with `--verbose` (CLI) or inspect the admin/replay server logs.
- Open Chrome DevTools → Network to see exactly which request fails.

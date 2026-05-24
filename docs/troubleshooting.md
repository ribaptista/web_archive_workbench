# Troubleshooting

Symptoms first, fixes after. If you can't find your issue here, run with
extra logging (browser DevTools console, or `--verbose` on the CLI) and
inspect the offending request.

## Install / startup

### `npm start` exits with "Either --domain or --all must be provided"

You omitted both. Pass `--domain example.com` (repeatable) or `--all`.

### "Either --max-req-per-second or --max-req-per-minute must be provided"

The CLI refuses to download without an explicit rate limit. Either pass one,
or add `--dry-run` to skip the download phase.

### "Admin server listening on http://localhost:5050" but the frontend shows network errors

- Confirm the admin server is reachable: `curl http://localhost:5050/api/domains/`.
- The Next.js dev server proxies `/api/*` to `BACKEND_URL` (default
  `http://localhost:5050`). If you changed the admin port, set
  `BACKEND_URL` accordingly before `npm run dev`.

### `EADDRINUSE` on `:5050`, `:5051`, or `:3000`

Something else is using the port. Either stop it or change the port — see
[configuration.md](configuration.md#advanced-changing-ports).

## CDX / downloading

### CDX fetch retries forever

The CLI retries CDX failures every 10 seconds indefinitely (by design — CDX
servers throttle aggressively). Inspect the printed `CDX fetch attempt N
failed` lines. If the error is permanent (DNS, auth), Ctrl+C and fix it.

### Many `429` or `connection reset` errors

You're being rate-limited by the archive. Drop `--max-req-per-second` /
add proxies via `--proxy-file`. Then `--skip-cdx-sync` to retry only the
failed entries.

This can also happen when many consecutive requests look like enumeration
(for example many timestamp variants of the same path, or URL series like
`/news?id=...`). Some upstream firewalls treat that as abusive and may
temporarily block source IPs. In that case, reduce both request pressure
dimensions:

- lower the per-proxy rate (`--max-req-per-second` or `--max-req-per-minute`),
- and lower global concurrency (`--concurrency`).

### Progress bar reaches 0 pending but new entries keep appearing

The CLI is still streaming CDX pages in the background and discovering new
entries. That's normal — wait for `Complete.`

### "URL domain is not equal to or a subdomain of"

From `add-resource-version`. The URL's host must match (or be under) the
`--domain` you passed.

## Admin frontend

### Pages render but show "No domains found" / empty lists

The data folder doesn't have any entries yet. Run the CLI first.

### Spinner forever, console says "Failed to fetch /api/..."

- Admin server isn't running, or
- It's bound to a different port and `BACKEND_URL` is wrong, or
- It's listening on a different host (defaults to `localhost`).

### `?page=abc` (or other invalid query params) gives a 500

The admin server is strict about numeric query params. Use plain numbers.

## Replay

### 404 on a replay URL

Possible causes:

- The snapshot isn't downloaded yet. Check **List versions** for the URL.
- The timestamp doesn't match any stored snapshot; the URL was hand-crafted.
- Normalization mismatch (rare). Try opening from **List versions** instead
  of typing the URL.

### Replayed page is blank or broken

You're almost certainly missing the Chrome extension or it's disabled.
Open DevTools → Network and look for requests to non-`localhost` origins;
those are the ones the extension should be rewriting.

### Replayed page loads but shows live content for some assets

Subresource is using a domain in the extension's allowlist (e.g. fonts,
CDNs). Check
[extension/chrome/background.js](../extension/chrome/background.js) → rule
2 and rule 3. Remove the allowed pattern if you want even those served
from your archive (if available).

### "Open in Remote Replay" shows an alert

The replay response didn't carry the `x-remote-live-replay-url` header.
The entry was downloaded before the column was added, or its
`--replay-base-url` was empty. Re-fetch the entry.

## Chrome extension

### Extension shows errors on `chrome://extensions`

Open the **service worker** inspect link and read the console. Common
causes:

- The constants at the top of `background.js` don't match a port you
  changed in `backend/src/config.ts`.
- A reload is needed after editing `background.js`.

### "Service worker is inactive"

That's normal — Chrome suspends MV3 service workers. The first request to
a replay URL wakes it up.

### Allowed URLs are still being redirected

Check rule priority. The current rules use priority 2 for allow rules and
priority 1 for the catch-all redirect, so allow wins. If you added a rule,
make sure its priority is ≥ 2.

## Search

### Search runs but never finishes

- Look at **Runs** to verify there's actually data to scan.
- Increase `--max-file-workers-per-search` on the admin server (`-w 32`).
- If the admin server crashed, restart it; in-flight searches are marked
  as such and may need to be deleted and re-run.

### Search "done" but 0 matches when I expected some

- Regexes execute against decoded body content. Make sure the file has a
  text-like content type — binaries are skipped.
- The not-nearby regex may be excluding everything. Try without it.

## SQLite

### "database is locked"

Two writers are open at the same time. Stop the CLI before running another
write-heavy task. Read-only access (admin server / replay server) is fine
alongside the CLI thanks to WAL mode.

### Database file grew suddenly

Probably the `-wal` file. SQLite checkpoints it during normal operation —
no action needed. Stopping every backend process cleans it up.

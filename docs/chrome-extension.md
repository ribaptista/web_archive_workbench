# Chrome extension

The Chrome extension is **required** to browse archived pages correctly.
Without it, your browser will reach out to the live web for any subresource
the archived HTML references, which usually breaks rendering.

## What it does

- Watches every network request initiated by `localhost`.
- **Allows** requests to:
  - the admin frontend (`localhost:3000`)
  - the admin backend (`localhost:5050`)
  - the replay server (`localhost:5051`)
  - a small CDN/font/social allowlist (jsDelivr, cdnjs, Google Fonts, etc.)
- **Redirects** everything else to
  `http://localhost:5051/replay/from_referer/<url>`, so the replay server
  can substitute the archived version.
- Adds two context-menu items on replayed pages:
  - **List versions** — opens the admin frontend's version list for the
    page's URL.
  - **Open in Remote Replay** — opens the same snapshot on the upstream
    archive (e.g. web.archive.org), using the `x-remote-live-replay-url`
    header set by the replay server.

## Install

The extension is in [extension/chrome/](../extension/chrome/) and is loaded
unpacked.

1. Open Chrome → `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `extension/chrome` folder of this repo.
5. The extension should appear in the list with no errors.

> The extension uses Manifest V3 (`declarativeNetRequest`, `webRequest`,
> `scripting`, `contextMenus`, `tabs`). Its host permission is `<all_urls>`
> because subresource rewriting needs to see every domain. Rules only fire
> when the request **initiator** is `localhost`, so normal browsing is
> unaffected.

## Verify it's working

1. Make sure the replay server is running.
2. Open a replay URL directly, e.g.:
   `http://localhost:5051/replay/<ts>/<archived-url>`.
3. Open Chrome DevTools → **Network**.
4. You should see most subresource requests resolve to URLs starting with
   `http://localhost:5051/replay/`. None of them should be hitting the
   live web for the original domain.

If you instead see requests going out to the real domain, the extension
isn't enabled or the page wasn't opened in a Chrome profile that has it.

## Context menus

Right-click anywhere on a page served from `http://localhost:5051/replay/*`:

- **List versions** — jumps to the admin frontend's [List Versions](frontend.md#list-versions)
  page for the same URL, so you can see all snapshots and statuses.
- **Open in Remote Replay** — opens the matching snapshot on the upstream
  archive (e.g. web.archive.org). This requires the replay response to
  carry an `x-remote-live-replay-url` header; otherwise you'll get an alert
  saying so.

## Configuration

The extension reads the following constants at the top of
[extension/chrome/background.js](../extension/chrome/background.js):

```js
const APP_HOST = 'localhost';
const ADMIN_FRONTEND_ORIGIN = `http://${APP_HOST}:3000`;
const ADMIN_BACKEND_ORIGIN  = `http://${APP_HOST}:5050`;
const REPLAY_SERVER_ORIGIN  = `http://${APP_HOST}:5051`;
```

If you changed any port or host in [backend/src/config.ts](../backend/src/config.ts),
update these to match, then reload the extension at `chrome://extensions`
(click the refresh icon on the extension's card).

## Troubleshooting

### Replayed page renders blank or with browser errors

- Confirm the extension is enabled.
- Confirm the replay server is running on `:5051`.
- In DevTools → Network, look for requests that are still going to the
  original (live) domain. If you find any, check the extension's rule list
  via `chrome://extensions` → **Inspect views: service worker** →
  Console.

### "Remote live replay URL is not available" alert

The replay response didn't include `x-remote-live-replay-url`. This happens
when the request hasn't been fetched via the CLI yet, or when the original
`--replay-base-url` wasn't recorded. Re-download that entry and try again.

### Extension loaded but rules don't fire

- Make sure the page was opened from a `localhost`-initiated context. The
  rules require `initiatorDomains: [localhost]`.
- Reload the extension after any code change.

### "List versions" opens the wrong URL

The context menu encodes the URL portion of the current tab's
`/replay/<ts>/<url>` path. If you manually edited the path, fix it and
retry.

## See also

- [Replay server](replay-server.md) — what the extension is talking to.
- [Frontend → List versions](frontend.md#list-versions) — where "List
  versions" lands.

# Chrome Extension

The extension (named **Wayback Request Logger**) is **required** for the
replay server to work properly. Without it, archived pages will load with
missing CSS, JS, and images.

## What it does

While you are browsing pages served from
`http://localhost:5051/replay/...`, the extension:

1. **Intercepts** every HTTP request initiated by a localhost tab.
2. **Allows** the request unchanged when it's already going to the admin
   server (`:3000`), the API (`:5050`), the replay server (`:5051`), or
   well-known CDNs (jsdelivr, cdnjs, Google Fonts, AddThis, Facebook).
3. **Redirects** everything else to
   `http://localhost:5051/replay/from_referer/<original-url>`, so the
   replay server can serve the archived version.
4. Adds two right-click menu items on replay pages:
   - **List versions** — opens the admin UI's list-of-versions for the
     current URL.
   - **Open in Wayback Machine** — opens the same snapshot on the public
     `web.archive.org`.

It has **no UI** and no popup; verification is done via DevTools (see below).

## Installation

1. Open `chrome://extensions` in Chrome / Edge / Brave / any
   Chromium-based browser.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked**.
4. Select the folder `extension/chrome/` from this repo.
5. The card titled **Wayback Request Logger** should appear, enabled.

You only need to do this once. The extension survives browser restarts.

## Verifying it works

### Quick check

1. Open the admin UI at `http://localhost:3000` and click any archived
   resource to open it via the replay server.
2. Open Chrome DevTools → **Network** tab.
3. Look at the request rows. Subresources for hosts like `*.googletagmanager.com`,
   `*.cloudflare.com`, etc. should show status `200` and be served from
   `localhost:5051` (column "Domain"), **not** failing.

### Detailed check

1. Open DevTools → **Console** on a replay page.
2. The extension's service worker logs each intercepted request as
   `[type] METHOD url`. Open `chrome://extensions` → click **Service
   worker** under the extension card to view its log.

### Right-click menu

Right-click any replay page. You should see:

- "List versions"
- "Open in Wayback Machine"

If they're missing, the extension is not active on this page (probably not
a `http://localhost:5051/replay/...` URL).

## Updating the extension

After pulling a new version of the repo:

1. Go to `chrome://extensions`.
2. Click the **reload** ↻ button on the **Wayback Request Logger** card.

## Troubleshooting

**Subresources still fail.**
The extension may be disabled, or installed for a different Chrome profile.
Confirm the toggle is on under `chrome://extensions`.

**Right-click menu missing.**
You must be on a `http://localhost:5051/replay/...` URL. The menu only
appears on replay pages.

**Browser blocks localhost requests entirely.**
Some corporate Chrome policies block extensions from making localhost
network requests. Use a personal Chrome profile.

**I want to allow another external domain.**
Edit [`extension/chrome/background.js`](../extension/chrome/background.js)
and add the host to the regex in rule `id: 3` (CDNs) or add a new rule.
Reload the extension.

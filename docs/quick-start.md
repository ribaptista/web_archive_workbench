# Quick Start

A complete end-to-end walkthrough: download one small domain, view it in
your browser, run a search, and tag findings. Should take ~15 minutes.

## Prerequisites

- Completed [installation.md](installation.md) (Node 20+, dependencies
  installed).
- Chrome/Chromium browser open.

## Step 1 — Pick a data folder

```bash
export DATA=~/wayback-data
mkdir -p "$DATA"
```

This will hold `archive.db` and all downloaded files.

## Step 2 — Preview what will be downloaded

```bash
cd backend
npm start -- --data-folder "$DATA" --domain example.com --dry-run --verbose
```

**Expected output:** a summary of CDX entries that would be downloaded
for `example.com`, with a per-domain count. No files are written.

## Step 3 — Run the download

```bash
npm start -- --data-folder "$DATA" --domain example.com --max-req-per-second 1
```

**Expected:** a live progress bar showing requested/downloaded/failed
counts. Files appear under `$DATA/example.com/`.

> Stop with `Ctrl+C` at any time; state is checkpointed to the DB.

## Step 4 — Start the admin server

In a second terminal:

```bash
cd backend
npx tsx src/admin_server/index.ts --data-folder "$DATA"
```

**Expected:** `Admin server listening on http://localhost:5050`.

## Step 5 — Start the replay server

In a third terminal:

```bash
cd backend
npx tsx src/replay_server/server.ts --data-folder "$DATA"
```

**Expected:** `Listening on http://localhost:5051`.

## Step 6 — Start the frontend

In a fourth terminal:

```bash
cd frontend
npm run dev
```

**Expected:** Next.js starts on `http://localhost:3000`.

## Step 7 — Install the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select the folder `extension/chrome/` from this repo.
5. The extension **Wayback Request Logger** should appear and be enabled.

See [chrome-extension.md](chrome-extension.md) for verification.

## Step 8 — Browse the archive

Visit **http://localhost:3000**. You will be redirected to **New Search**.
Use the top nav to go to **Resources**.

1. Click `example.com` to drill into its resource tree.
2. Keep clicking subpaths until you reach a leaf marked **resource**.
3. Click the leaf — it opens the **Versions** page.
4. Click any timestamp — the archived page opens in a new tab, served from
   the replay server at `http://localhost:5051/replay/<timestamp>/<url>`.

The page should render exactly as it did historically, with all subresources
also served locally.

## Step 9 — Run a regex search

1. Click **New Search** in the top nav.
2. Enter a regex, e.g. `email|contact`.
3. Optionally add a "Not nearby" pattern to exclude matches surrounded by
   certain text.
4. Pick which domains to scan (default: all).
5. Click **Run Search**.

You're redirected to **Search Results** with live progress. Files with
matches appear with surrounding context highlighted.

## Step 10 — React to a finding

On a search result card, click the **Like** or **Review later** button.
Visit **Reactions** in the top nav to see everything you tagged.

## Next steps

- [common-workflows.md](common-workflows.md) — bulk downloads, retrying
  errors, working with proxies.
- [frontend.md](frontend.md) — every page in detail.
- [troubleshooting.md](troubleshooting.md) — fix common issues.

# Quick start

This walks you through downloading a small domain and browsing it locally.
Total time: about 5 minutes plus download time.

## Prerequisites

- You've completed [installation](installation.md).
- You have a data folder, e.g. `~/wab-data`.
- You have four terminal windows available.

## 1. Download some content

In **terminal 1**, from `backend/`:

```bash
npm start -- \
  --data-folder ~/wab-data \
  --domain example.com \
  --max-req-per-second 1 \
  --concurrency 2
```

What this does:

1. Fetches the CDX index for `example.com` from `web.archive.org`.
2. Registers every snapshot in your local database.
3. Downloads each snapshot's body, respecting the per-proxy rate limit and
   the global concurrency cap.

You can stop at any time with `Ctrl+C`. The next run will resume.

**Expected output**: a progress bar showing `succeeded / failed / pending`,
followed by a `Complete.` line when there's nothing left to fetch.

> **Tip**: try `--dry-run --verbose` first to see exactly what would be
> downloaded.

## 2. Start the admin server

In **terminal 2**, from `backend/`:

```bash
npm run admin-server -- --data-folder ~/wab-data
```

**Expected output**: `Admin server listening on http://localhost:5050`.

## 3. Start the replay server

In **terminal 3**, from `backend/`:

```bash
npm run replay-server -- --data-folder ~/wab-data
```

**Expected output**: `Listening on http://localhost:5051`.

## 4. Start the admin frontend

In **terminal 4**, from `frontend/`:

```bash
npm run dev
```

**Expected output**: Next.js dev server on `http://localhost:3000`. Open it
in Chrome — you'll land on the **New Search** page.

## 5. Install the Chrome extension

The replay server serves archived HTML that contains absolute URLs pointing
at the original sites (e.g. `https://example.com/foo.js`). The Chrome
extension transparently redirects those to your local replay server so the
page renders correctly.

Follow [chrome-extension.md](chrome-extension.md). You'll come back here
afterward.

## 6. Browse what you downloaded

1. In the admin frontend, click **Domains**. You should see `example.com`
   with a count of downloaded resources.
2. Click **Resources** to browse by URL path.
3. Or run a search: **New Search** → enter a regex → submit. You'll be
   redirected to a results page that streams in matches.

## 7. Open a replay

From any results page or version list, click a file's URL. Chrome opens the
replay URL, the extension catches subresource requests, and the page should
render using only your local data.

If the page looks broken, see [troubleshooting.md](troubleshooting.md).

## What's next

- [Common workflows](common-workflows.md) — re-running downloads, filtering
  errors, comparing runs.
- [Admin frontend](frontend.md) — full page-by-page tour.
- [CLI](cli.md) — every option of the downloader.

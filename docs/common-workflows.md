# Common Workflows

End-to-end recipes for the most frequent tasks. Each one assumes you've
completed [installation.md](installation.md).

## Workflow 1 — Download a single domain

```bash
export DATA=~/wayback-data
cd backend
npm start -- --data-folder "$DATA" --domain example.com --max-req-per-second 1
```

Open the frontend → **Domains** to confirm the entry count is growing.

---

## Workflow 2 — Preview before committing to a long download

```bash
npm start -- --data-folder "$DATA" --domain bigsite.com --dry-run --verbose
```

You'll see how many CDX entries will be fetched. If too many, narrow
the scope on the Wayback CDX side (currently not exposed; you can pre-seed
the DB by passing only a subset of domains and re-running with `--all`).

---

## Workflow 3 — Speed up downloads with proxies

1. Create `proxies.txt`:

   ```
   user1:pass1@1.2.3.4:8080
   user2:pass2@5.6.7.8:8080
   ```

2. Run with rotating proxies:

   ```bash
   npm start -- --data-folder "$DATA" --domain bigsite.com \
     --proxy-file ./proxies.txt \
     --max-req-per-second 2 --concurrency 40
   ```

Effective rate ≈ `proxies × max-req-per-second`, capped by `concurrency`.

---

## Workflow 4 — Retry failed entries

```bash
npm start -- --data-folder "$DATA" --domain example.com \
  --skip-cdx-sync --max-req-per-second 1
```

This **skips fetching new CDX entries** and only re-attempts entries that
errored or are still pending.

To drop persistent 404s from the retry pool, mark them as success:

```bash
npm start -- --data-folder "$DATA" --domain example.com \
  --skip-cdx-sync --skip-error 404 --max-req-per-second 1
```

---

## Workflow 5 — Run a regex search and triage

1. Start all three backend processes + frontend (see
   [quick-start.md](quick-start.md)).
2. **New Search** → enter a regex like `(api[_-]?key|secret)\s*[:=]`.
3. Optionally add a **Not nearby** pattern (e.g. `example|placeholder`) to
   ignore obvious false positives.
4. Submit, watch results stream in.
5. For interesting files, click the timestamp link → opens in the replay
   server.
6. Tag with **Like** to keep, **Review later** to defer.
7. Visit **Reactions** later to compile your findings.

---

## Workflow 6 — Inspect every snapshot of one URL

1. Click any replay link to open an archived page.
2. **Right-click → List versions** (provided by the Chrome extension).
3. The admin UI opens `/list_versions?originalUrl=...` showing every
   archived timestamp with status.

---

## Workflow 7 — Browse the archive by URL path

1. Top nav → **Resources**.
2. Drill into a domain.
3. Continue through path segments. Leaves are marked **resource**.
4. Click a leaf → **Versions** page.
5. Pick a timestamp → opens in the replay server.

---

## Workflow 8 — Refresh existing domains nightly

Run as a cron job:

```bash
0 3 * * *  cd /path/to/backend && \
  npm start -- --data-folder /srv/wayback --all \
  --max-req-per-minute 60 > /var/log/wayback.log 2>&1
```

The downloader is idempotent: only new CDX entries get fetched.

---

## Workflow 9 — Run the admin/replay stack as a service

Sketch using systemd:

```ini
# /etc/systemd/system/wayback-admin.service
[Service]
ExecStart=/usr/bin/npx tsx /opt/wayback/backend/src/admin_server/index.ts \
  --data-folder /srv/wayback
WorkingDirectory=/opt/wayback/backend
Restart=always
```

Mirror for the replay server on port 5051. Front the admin UI with a
reverse proxy if you need remote access (add auth!).

# Common workflows

End-to-end recipes for the day-to-day tasks. Each assumes you've finished
[quick start](quick-start.md) at least once.

## Download a new domain from scratch

```bash
cd backend
npm start -- -b ~/wab-data --domain new-target.com --max-req-per-second 2
```

Watch the progress bar. When it settles at `Complete.`, open the admin
frontend → **Domains** → confirm a row for `new-target.com`.

## Re-run only failed/pending entries

The CLI's first phase queries CDX. Skip it when you only want to retry
existing failures:

```bash
npm start -- -b ~/wab-data --domain new-target.com \
  --skip-cdx-sync --max-req-per-second 1
```

Confirm via **Domain errors** that the count went down.

## Re-sync CDX without downloading

Useful to discover newly archived snapshots without spending bandwidth:

```bash
npm start -- -b ~/wab-data --domain new-target.com --dry-run --verbose
```

This shows how many new CDX entries would be added and a sample of them. To
commit them and download, re-run without `--dry-run`.

## Investigate a specific error class

1. Open **Domains** → click the errored badge for the domain.
2. In **Domain errors**, uncheck everything except the codes/names you care
   about.
3. Decide:
   - If they're recoverable (timeouts, connection resets), re-run the CLI
     with `--skip-cdx-sync`.
   - If they're permanent (`451`, `404`), suppress them next time with
     `--skip-error-code 451`.

## Triage matches from a search

1. **New Search** → enter a regex (and optionally a not-nearby exclusion) →
   pick domains → submit.
2. On **Search results**:
   - Use the domain/condition filters to narrow down.
   - Click into a file's preview to open it in the replay server.
   - React to keepers with 👍 / ⭐ / whatever's configured.
3. Later: open **Reactions** to revisit only the files you flagged.

## Compare runs

1. Open **Runs**.
2. Each card lists the args that produced it and the resulting counts
   (new CDX entries, requested, downloaded, errored, broken down by
   domain and error type).
3. Look for spikes in errored entries between consecutive runs targeting
   the same domain.

## Manually add a snapshot CDX doesn't know about

```bash
npm run add-resource-version -- \
  --data-folder ~/wab-data \
  --url 'https://example.com/page' \
  --timestamp 20230501120000 \
  --domain example.com
```

Then re-run the downloader with `--skip-cdx-sync` to fetch its body.

## Verify replay works on a single URL

```
http://localhost:5051/replay/<timestamp>/<archived-url>
```

If it 404s, the snapshot isn't downloaded (or the timestamp is wrong — try
the same URL via **List versions** and click through).

## Promote a search worker pool for big runs

Heavy regex pipelines benefit from more workers. Restart the admin server
with:

```bash
npm run admin-server -- -b ~/wab-data -s 4 -w 32 --context-size 96
```

| Flag                | Effect                                                     |
| ------------------- | ---------------------------------------------------------- |
| `-s 4`              | Up to 4 searches in parallel.                              |
| `-w 32`             | 32 file-scan workers per search.                           |
| `--context-size 96` | Wider window for evaluating `not_regex_nearby` exclusions. |

## Migrate the data folder

It's safe to move/copy the folder while no backend process is running.
SQLite files (`archive.sqlite`, `-shm`, `-wal`) and the assets directory
must move together.

## Shut everything down

`Ctrl+C` in each of: CLI, admin server, replay server, frontend. All four
shutdown cleanly. Database is durable.

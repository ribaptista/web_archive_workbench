# CLI Reference

The CLI downloads CDX index entries and asset files from the Wayback
Machine into your data folder.

## Invocation

From `backend/`:

```bash
npm start -- --data-folder <DATA> [flags]
# or equivalently
npx tsx src/cli/index.ts --data-folder <DATA> [flags]
```

`--` separates `npm` flags from script flags.

## Required

You must provide:

- `--data-folder` / `-b`
- Either `--domain <name>` (one or more) **or** `--all`
- Either `--max-req-per-second` **or** `--max-req-per-minute`
  (not required for `--dry-run`)

## Flags

| Flag                   | Type     | Default                 | Description                                                                                                 |
| ---------------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--data-folder`, `-b`  | string   | — (required)            | Folder holding `archive.db` and downloaded assets.                                                          |
| `--domain`             | string[] | —                       | One or more domains to process. Repeat the flag or pass multiple values.                                    |
| `--all`                | bool     | `false`                 | Process every domain already present in the database. Mutually exclusive with `--domain`.                   |
| `--max-req-per-second` | number   | —                       | Per-proxy rate cap (one of `--max-req-per-second` / `--max-req-per-minute` is required outside of dry-run). |
| `--max-req-per-minute` | number   | —                       | Per-proxy rate cap.                                                                                         |
| `--concurrency`        | number   | `5`                     | Max in-flight HTTP requests across all proxies.                                                             |
| `--proxy-file`         | path     | —                       | File with `[user:pass@]host:port` per line. Without it, all traffic goes through your IP.                   |
| `--cdx-page-size`      | int      | `128`                   | Page size for CDX API requests.                                                                             |
| `--cdx-base-url`       | URL      | IA default              | Override CDX endpoint (e.g. self-hosted pywb).                                                              |
| `--cdx-strategy`       | enum     | `json_wayback`          | `json_wayback` for the real Wayback API; `json_pywb` for pywb-style jsonlines.                              |
| `--replay-base-url`    | URL      | `http://localhost:5051` | Stored with downloaded HTML so rewritten links point at your replay server.                                 |
| `--skip-cdx-sync`      | bool     | `false`                 | Skip fetching new CDX entries; only retry errored or pending entries.                                       |
| `--skip-error`         | string[] | —                       | HTTP/error code(s) treated as success (e.g. `--skip-error 404`).                                            |
| `--skip-error-message` | string[] | —                       | Substring(s) of error messages treated as success.                                                          |
| `--dry-run`            | bool     | `false`                 | Print a summary; do not download.                                                                           |
| `--verbose`, `-v`      | bool     | `false`                 | Show per-entry detail in dry-run output.                                                                    |

## Common invocations

### First-time download of a domain (gentle)

```bash
npm start -- --data-folder "$DATA" \
  --domain example.com \
  --max-req-per-second 1
```

### Multiple domains

```bash
npm start -- --data-folder "$DATA" \
  --domain a.example.com --domain b.example.com \
  --max-req-per-second 2
```

### Refresh every previously-downloaded domain

```bash
npm start -- --data-folder "$DATA" --all --max-req-per-minute 30
```

### Retry only the entries that failed last time

```bash
npm start -- --data-folder "$DATA" --domain example.com \
  --skip-cdx-sync --max-req-per-second 1
```

### Use rotating proxies

```bash
npm start -- --data-folder "$DATA" --domain example.com \
  --proxy-file ./proxies.txt --max-req-per-second 1 --concurrency 20
```

Each proxy is rate-limited independently, so the effective throughput is
`max-req-per-second × number-of-proxies`, capped by `--concurrency`.

### Treat 404s as "done, don't retry"

```bash
npm start -- --data-folder "$DATA" --domain example.com \
  --skip-error 404 --max-req-per-second 1
```

## What you see during a run

1. A short CDX sync banner.
2. A live progress bar:
   `[============>      ] succeeded: 412, failed: 5, pending: 230`
3. A summary on exit:
   `Complete. succeeded: 642, failed: 5`

Each run also appears in the **Runs** page of the frontend with full
per-domain statistics.

## Re-running is safe

- Already-downloaded entries are skipped.
- New CDX entries are merged into the database.
- Errors are retryable via `--skip-cdx-sync`.

## Pitfalls

- **No rate limit ⇒ ban**. Always supply one of the `--max-req-per-*` flags.
- **Wrong data folder** ⇒ the admin server won't show your downloads.
  Always reuse the same path.
- **`--all` is global**: it processes every domain in the DB, even ones you
  added accidentally.

# CLI

The CLI is the workhorse that fills your archive. It:

1. fetches the CDX index for one or more domains,
2. records each snapshot in the database, and
3. downloads each snapshot's body to disk, tracking errors and retries.

It is **resumable**: re-running picks up where you left off. Every run gets
a unique ID so you can see which run produced which entries.

## Running

From `backend/`:

```bash
npm start -- \
  --data-folder /path/to/data \
  --domain example.com \
  --max-req-per-second 1
```

`npm start --` is equivalent to `npx tsx src/cli/main/index.ts` — use either.

## Required arguments

| Argument                                                | Description                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `--data-folder`, `-b`                                   | Folder containing the SQLite DB and asset blobs.                                                |
| `--domain <name>`<br>or `--all`                         | Target one or more domains, or replay every domain already in the database. Mutually exclusive. |
| `--max-req-per-second N`<br>or `--max-req-per-minute N` | Per-proxy rate limit. Required for live runs; ignored with `--dry-run`. Mutually exclusive.     |

`--domain` can be repeated: `--domain a.com --domain b.com`.

## Common arguments

| Argument                 | Default | Description                                                    |
| ------------------------ | ------- | -------------------------------------------------------------- |
| `--concurrency N`        | 5       | Max simultaneous downloads globally (not per proxy).           |
| `--proxy-file FILE`      | none    | One proxy per line. See [proxies](#proxies).                   |
| `--cdx-page-size N`      | 128     | CDX result page size.                                          |
| `--skip-cdx-sync`        | false   | Skip the CDX fetch step and only retry pending/failed entries. |
| `--dry-run`              | false   | Show what would be done without downloading.                   |
| `--verbose`, `-v`        | false   | With `--dry-run`, list individual entries.                     |
| `--skip-error-code CODE` | —       | Treat the given error code as success (repeatable).            |
| `--skip-error-name NAME` | —       | Treat any error with this error name as success (repeatable).  |

## CDX source arguments

| Argument                | Default                                 | Description                                                                                                                                                         |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--cdx-base-url URL`    | `http://web.archive.org/cdx/search/cdx` | Where to query CDX.                                                                                                                                                 |
| `--cdx-strategy`        | `json_wayback`                          | `json_wayback` (Wayback resumeKey pagination) or `json_pywb` (pywb single-page jsonlines).                                                                          |
| `--cdx-from TIMESTAMP`  | —                                       | Lower-bound CDX timestamp filter (YYYYMMDDhhmmss or any prefix). Only valid without `--skip-cdx-sync`.                                                              |
| `--cdx-to TIMESTAMP`    | —                                       | Upper-bound CDX timestamp filter (YYYYMMDDhhmmss or any prefix). Only valid without `--skip-cdx-sync`. If both are set, `--cdx-from` must be lower than `--cdx-to`. |
| `--replay-base-url URL` | `https://web.archive.org/web/`          | Recorded with each entry; used to construct the `x-remote-live-replay-url` header during replay.                                                                    |

## Examples

### First-time download

```bash
npm start -- -b ~/wab-data --domain example.com \
  --cdx-from 20260301000000 \
  --max-req-per-second 2
```

### Resume failed/pending entries only

If your last run had errors and you want to retry without re-querying CDX:

```bash
npm start -- -b ~/wab-data --domain example.com \
  --skip-cdx-sync --max-req-per-second 1
```

### Dry-run preview

See how many new CDX entries would be added and how many downloads would
run, without doing either:

```bash
npm start -- -b ~/wab-data --domain example.com --dry-run --verbose
```

### Treat a known error class as success

Useful when an archive consistently 451s some URLs and you'd rather move on:

```bash
npm start -- -b ~/wab-data --domain example.com \
  --max-req-per-second 1 \
  --skip-error-code 451
```

### Process every domain in the database

```bash
npm start -- -b ~/wab-data --all --skip-cdx-sync --max-req-per-second 1
```

### Use pywb instead of Wayback

```bash
npm start -- -b ~/wab-data --domain example.com \
  --cdx-base-url http://my-pywb.local/coll/cdx \
  --cdx-strategy json_pywb \
  --replay-base-url http://my-pywb.local/coll/ \
  --max-req-per-second 4
```

## Proxies

Pass `--proxy-file path/to/proxies.txt` where each line is:

```
user:pass@host:port
```

Rate limits are applied **per proxy**, so 50 proxies × `--max-req-per-second 1`
= 50 req/s globally. `--concurrency` is a separate **global** cap across all
proxies and domains (it is not per proxy). Without a proxy file, all traffic
uses the default network interface.

An example with sample credentials lives at `backend/proxy.txt` — replace
with your own.

> **Note on scale:** even with generous kernel/system limits (file
> descriptors, ephemeral ports, etc.), pointing too many proxies at once
> can overwhelm parts of your local network infrastructure — most often
> the modem/router, which may have low limits on concurrent NAT sessions
> or DNS lookups. As a tested baseline, 50 proxies with
> `--max-req-per-second 1` and `--concurrency 25` ran reliably. Scale up
> gradually and watch for connection resets, DNS failures, or modem
> lockups before raising any of these knobs.

## What runs and what doesn't survive `Ctrl+C`

- Anything already written to the database **is durable** (WAL mode).
- An in-flight download is aborted cleanly; the entry stays "pending" and
  will be retried on the next run.
- Failed entries record their error code and message in the database; they
  surface in the **Domain errors** page of the frontend.

## `add-resource-version` (manual insert)

A separate one-shot script registers a single URL/timestamp pair without
going through CDX. Useful when you know a snapshot exists but the CDX server
doesn't list it.

```bash
npm run add-resource-version -- \
  --data-folder ~/wab-data \
  --url 'https://example.com/page' \
  --timestamp 20230501120000 \
  --domain example.com
```

The URL's domain must equal or be a subdomain of `--domain`.

## Output

While running, you'll see two progress bars:

```
[downloads] |████░░░░| 412/1024 | succeeded: 400 | failed: 12 | cdx scanned: 2048 | new: 1024 | ETA: 3m
[agents]    |██░░░░░░| 12/50 idle | inflight: 35 | recovering: 3
```

**Downloads bar** — one tick per finished snapshot download:

| Field         | Meaning                                                                              |
| ------------- | ------------------------------------------------------------------------------------ |
| `value/total` | Finished downloads vs total queued. `total` grows as CDX sync discovers new entries. |
| `succeeded`   | Downloads that completed and were stored.                                            |
| `failed`      | Downloads that errored out (recorded with their error code, available for retry).    |
| `cdx scanned` | CDX rows examined so far across all domains.                                         |
| `new`         | CDX rows that were new to the database (i.e. queued for download).                   |
| `ETA`         | Estimated time to drain the queue at current throughput.                             |

**Agents bar** — live state of the proxy pool (or the single default
interface if no `--proxy-file`). Each agent is one proxy:

| Field         | Meaning                                                                             |
| ------------- | ----------------------------------------------------------------------------------- |
| `value/total` | Idle agents (available to take work) vs total agents in the pool.                   |
| `inflight`    | Agents currently executing a request.                                               |
| `recovering`  | Agents temporarily benched after a network error, in exponential backoff (1m → 4m). |

On completion (or `Ctrl+C`) you get a final summary like:

```
Complete. succeeded: 1024, failed: 12
```

Per-run statistics are visible later under the [Runs page](frontend.md#runs).

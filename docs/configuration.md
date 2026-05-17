# Configuration

## Minimum required configuration

Just the **data folder** path, passed to every backend process:

```bash
--data-folder /path/to/data
```

The same folder must be used by the CLI, the admin server, and the replay
server. They all open `<folder>/archive.sqlite` and read/write asset blobs
beneath it.

That's it for the minimum. Everything else has sensible defaults.

## Default ports and hosts

Defined in [backend/src/config.ts](../backend/src/config.ts):

| Constant                | Value     |
| ----------------------- | --------- |
| `APP_HOST`              | localhost |
| `ADMIN_FRONTEND_PORT`   | 3000      |
| `ADMIN_BACKEND_PORT`    | 5050      |
| `REPLAY_SERVER_PORT`    | 5051      |

These are referenced consistently by:

- the admin server (binds to `:5050`),
- the replay server (binds to `:5051`),
- the admin frontend (`next dev` defaults to `:3000`),
- the Chrome extension (declarative network rules reference all three).

Changing them is currently a code edit, not a runtime flag — see
[Advanced: changing ports](#advanced-changing-ports) below.

## Environment variables

### Frontend → backend proxy

The Next.js dev server proxies `/api/*` to the admin server. The target URL
can be overridden:

| Variable      | Default                  | Used by             |
| ------------- | ------------------------ | ------------------- |
| `BACKEND_URL` | `http://localhost:5050`  | [frontend/next.config.ts](../frontend/next.config.ts) |

### Replay server URL exposed to the browser

A few admin frontend pages link directly to the replay server (e.g. the
"open" link on a version). They read this:

| Variable                       | Default                  |
| ------------------------------ | ------------------------ |
| `NEXT_PUBLIC_REPLAY_SERVER_URL`| `http://localhost:5051`  |

## CLI options

The downloader has many flags — see [cli.md](cli.md) for the full list. Only
two are strictly required:

- `--data-folder` (always)
- `--max-req-per-second` **or** `--max-req-per-minute` (for live runs;
  ignored with `--dry-run`)

Plus either `--domain <name>` (one or more times) or `--all`.

## Advanced: changing ports

If you need a non-default port (e.g. 5050 is already in use), edit
[backend/src/config.ts](../backend/src/config.ts). Then:

1. Restart the admin server and replay server.
2. Update the matching constants at the top of
   [extension/chrome/background.js](../extension/chrome/background.js)
   (`APP_HOST` and the three port-derived origin URLs).
3. Reload the Chrome extension at `chrome://extensions`.
4. If you changed the admin backend port, set `BACKEND_URL` when running the
   frontend, e.g. `BACKEND_URL=http://localhost:9050 npm run dev`.
5. If you changed the replay port, set `NEXT_PUBLIC_REPLAY_SERVER_URL` for
   the frontend.

## Data folder layout

After a run, the folder looks roughly like:

```
~/wab-data/
├── archive.sqlite          # all metadata, search results, reactions
├── archive.sqlite-shm      # SQLite shared-memory file (WAL mode)
├── archive.sqlite-wal      # SQLite write-ahead log
└── assets/
    └── <2-char-prefix>/<digest>   # asset blobs, content-addressed
```

The asset path is derived deterministically from the body digest, so the
same body downloaded twice is stored once.

## Networking / proxy

If you're hitting an aggressive CDX server, supply a `--proxy-file` with one
proxy per line (`user:pass@host:port`). See [cli.md#proxies](cli.md#proxies).

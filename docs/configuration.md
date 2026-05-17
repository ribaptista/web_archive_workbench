# Configuration

The system is configured almost entirely through **CLI flags** passed at
startup. There is a small number of environment variables for the frontend.

## Minimal required configuration

You only need one thing: a **data folder**.

```bash
export DATA=~/wayback-data
mkdir -p "$DATA"
```

Pass it to every component:

```bash
# CLI
npm start -- --data-folder "$DATA" --domain example.com --max-req-per-second 1

# Admin server
npx tsx src/admin_server/index.ts --data-folder "$DATA"

# Replay server
npx tsx src/replay_server/server.ts --data-folder "$DATA"
```

The database file (`$DATA/archive.db`) is created and migrated automatically.

## Backend flags

See the individual component docs for full references:

- [CLI flags](cli.md#flags)
- [Admin server flags](admin-server.md#startup-flags)
- [Replay server flags](replay-server.md#startup-flags)

## Frontend environment variables

The frontend is a Next.js app. Set these before `npm run dev` / `npm run start`:

| Variable                        | Default                 | Purpose                                                            |
| ------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| `BACKEND_URL`                   | `http://localhost:5050` | Where the frontend proxies `/api/*` to (the admin server).         |
| `NEXT_PUBLIC_REPLAY_SERVER_URL` | `http://localhost:5051` | Used to build links that open archived pages in the replay server. |

Example with non-default ports:

```bash
BACKEND_URL=http://localhost:6000 \
NEXT_PUBLIC_REPLAY_SERVER_URL=http://localhost:6001 \
npm run dev
```

> Note: `NEXT_PUBLIC_*` variables are baked into the build. Restart `next
dev` after changing them.

## Proxies (optional, CLI only)

Create a UTF-8 text file with one proxy per line:

```
user:pass@host:port
user:pass@host:port
host:port
```

Pass it to the CLI:

```bash
npm start -- --data-folder "$DATA" --domain example.com \
  --proxy-file ./proxies.txt --max-req-per-second 1
```

Each proxy is rate-limited independently, so the effective request rate is
`max-req-per-second × number-of-proxies`.

## Advanced configuration

### Search worker pool (admin server)

| Flag                                   | Default | Purpose                                        |
| -------------------------------------- | ------- | ---------------------------------------------- |
| `--max-concurrent-searches` / `-s`     | 2       | How many searches can run in parallel.         |
| `--max-file-workers-per-search` / `-w` | 16      | Worker threads per search.                     |
| `--context-size`                       | 64      | Characters of context shown around each match. |

Increase `-w` for faster searches on a many-core machine; decrease if your
disk I/O is the bottleneck.

### CDX strategy (CLI)

| Flag              | Values                      | Default        |
| ----------------- | --------------------------- | -------------- |
| `--cdx-base-url`  | URL                         | IA's CDX API.  |
| `--cdx-strategy`  | `json_wayback`, `json_pywb` | `json_wayback` |
| `--cdx-page-size` | integer                     | 128            |

Use `json_pywb` when pointing `--cdx-base-url` at a self-hosted [pywb](https://pywb.readthedocs.io/) instance.

### Replay base URL (CLI)

`--replay-base-url` controls the **rewriting target** stored alongside
downloaded HTML so internal links resolve to your replay server. The default
(`http://localhost:5051`) is correct for local installs.

## Pitfalls

- All three backends **must point at the same data folder**, otherwise the
  admin UI will look empty or the replay server will return 404s.
- The default `--max-req-per-second 1` is the **safe** default. Higher values
  may get you rate-limited by the Internet Archive.
- The admin/replay servers bind to `127.0.0.1`. Do not expose them to the
  public internet without a reverse proxy and auth — there is **no
  authentication**.

# Admin Server

The admin server is a [Fastify](https://fastify.dev/) HTTP API that the
frontend talks to. It exposes endpoints for domains, runs, resources,
searches, and reactions.

You generally don't call it directly — you use the [frontend](frontend.md).

## Run it

From `backend/`:

```bash
npx tsx src/admin_server/index.ts --data-folder "$DATA"
```

Default port: **5050**. Bound to `127.0.0.1` only.

## Startup flags

| Flag                                  | Default      | Purpose                                                        |
| ------------------------------------- | ------------ | -------------------------------------------------------------- |
| `--data-folder`, `-b`                 | — (required) | Folder holding `archive.db` and downloaded assets.             |
| `--max-concurrent-searches`, `-s`     | `2`          | How many searches can run in parallel.                         |
| `--max-file-workers-per-search`, `-w` | `16`         | Worker threads per search. Higher = faster on multi-core CPUs. |
| `--context-size`                      | `64`         | Characters of context shown around each regex match.           |

## What lives where

| URL prefix           | Used for                             |
| -------------------- | ------------------------------------ |
| `/api/domains`       | Domain listing & stats               |
| `/api/runs`          | CLI run history                      |
| `/api/searches`      | Create / inspect / delete searches   |
| `/api/resources`     | Tree browser of downloaded resources |
| `/api/list_versions` | Versions for one URL                 |
| `/api/cdx`           | Internal CDX lookups                 |
| `/api/reactions`     | Like / Review-later flags            |

The frontend reverse-proxies `/api/*` to this server
via [`next.config.ts`](../frontend/next.config.ts), so end users never see
these URLs directly.

## Verifying it's up

```bash
curl http://localhost:5050/api/domains/
# => [{"name":"example.com"}, ...]
```

If you see `Connection refused`, the admin server isn't running.

## Logging

Fastify pretty-prints request logs to stdout. Each line shows method, URL,
status, and latency.

## Restarting safely

Use `Ctrl+C`. The search worker pool is terminated cleanly via signal
handlers.

## Pitfalls

- The admin server **must use the same `--data-folder`** as the CLI and
  replay server. Otherwise the frontend shows no data or returns 404s.
- There is **no authentication**. Don't expose the port publicly.
- The server expects the schema migrations bundled in `src/db/migrations`.
  These run automatically when the DB is first opened.

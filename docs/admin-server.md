# Admin server

The admin server is a Fastify HTTP API that exposes the contents of the
archive database to the admin frontend. It does not download anything — it
only reads/writes the database the CLI populated, plus search results and
reactions.

## Running

From `backend/`:

```bash
npx tsx src/admin_server/index.ts --data-folder /path/to/data
```

**Expected output**: `Admin server listening on http://localhost:5050`.

The server binds to `localhost:5050` by default (see
[configuration](configuration.md)).

## Options

| Argument                          | Default | Description |
| --------------------------------- | ------- | ----------- |
| `--data-folder`, `-b`             | —       | **Required.** Same folder used by the CLI. |
| `--max-concurrent-searches`, `-s` | 2       | How many searches may run in parallel. Each search owns a worker pool. |
| `--max-file-workers-per-search`, `-w` | 16  | Number of worker threads scanning files per running search. |
| `--context-size`                  | 64      | Characters of context shown around each regex match. |

Tune these based on your machine. A search with N file workers will use up
to N CPU cores; combined `s × w` is the worst-case worker count.

## Endpoints

The frontend talks to these via `/api/*`. Most have no auth and only listen
on `localhost`.

| Route                         | Verb   | Purpose                              |
| ----------------------------- | ------ | ------------------------------------ |
| `/api/domains/`               | GET    | List all known domain names.         |
| `/api/domains/stats`          | GET    | Per-domain resource and request counts. |
| `/api/domains/errors`         | GET    | Paginated error entries for a domain. |
| `/api/domains/error_filters`  | GET    | Distinct error codes/names per domain. |
| `/api/runs/`                  | GET    | All runs and their summary stats.    |
| `/api/resources`              | GET    | Browse the URL tree by path segment. |
| `/api/list_versions`          | GET    | All versions of a single URL.        |
| `/api/searches/`              | GET    | List all searches.                   |
| `/api/searches/`              | POST   | Start a new search.                  |
| `/api/searches/:id`           | DELETE | Delete a search and its results.     |
| `/api/searches/:id/results`   | GET    | Paginated, filtered results for one search. |
| `/api/reactions/`             | GET    | The reactions view (files reacted with a given type). |
| `/api/reactions/`             | POST   | Toggle a reaction on a resource version. |

You can hit them with `curl` for debugging:

```bash
curl http://localhost:5050/api/domains/stats | jq
```

## Graceful shutdown

Send `SIGINT` or `SIGTERM` (Ctrl+C). The server terminates its search
worker pool before exiting.

## See also

- [Admin frontend](frontend.md) — the UI that consumes this API.
- [Common workflows](common-workflows.md) — when to start what.

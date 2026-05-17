# Replay Server

The replay server serves archived pages from your data folder so that
historical URLs render correctly in your browser, with all subresources
(images, CSS, JS, …) pulled from your local copy instead of the live web.

## Run it

From `backend/`:

```bash
npx tsx src/replay_server/server.ts --data-folder "$DATA"
```

Default port: **5051**. Bound to `127.0.0.1` only.

## Startup flags

| Flag                  | Default                 | Purpose                                            |
| --------------------- | ----------------------- | -------------------------------------------------- |
| `--data-folder`, `-b` | — (required)            | Folder holding `archive.db` and downloaded assets. |
| `--admin-url`         | `http://localhost:3000` | Currently informational; reserved for cross-links. |

## URL shape

```
http://localhost:5051/replay/<TIMESTAMP>/<ORIGINAL_URL>
```

Example:

```
http://localhost:5051/replay/20180101120000/https://example.com/about
```

`<TIMESTAMP>` is the Wayback-style `YYYYMMDDHHMMSS` value stored in the DB.

## How it works with the Chrome extension

When you click a replay link from the admin UI:

1. The browser opens `http://localhost:5051/replay/.../some-page.html`.
2. The replay server returns the archived HTML, rewritten so internal
   absolute/relative links go back through `/replay/...`.
3. The page tries to load CSS, JS, images, etc. — those go to all sorts of
   external hosts.
4. The **Chrome extension** intercepts every non-replay request initiated
   from `localhost` and redirects it to:
   `http://localhost:5051/replay/from_referer/<original_url>`
5. The replay server inspects the `Referer` header to figure out the right
   timestamp and serves the locally archived subresource.

Without the extension, subresources will mostly **fail to load** (or worse,
fetch from the live web).

See [chrome-extension.md](chrome-extension.md) for setup.

## Three URL handlers

| Route                           | Purpose                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /replay/:timestamp/:url`   | Serve a specific snapshot of `:url`.                                                                |
| `GET /replay/from_referer/:url` | Serve `:url` using the timestamp from the `Referer` header. Used by the extension for subresources. |
| `GET /__localhost_rewrite/...`  | Helper used by the extension when rewriting `localhost`-targeted requests.                          |

## Relationship between components (user view)

```
Admin frontend  ──>  builds replay links  ──>  http://localhost:5051/replay/...
        │
        │ user clicks
        ▼
   Browser tab  ──>  Replay server (returns rewritten HTML)
        │
        │ page loads CSS/JS/images
        ▼
   Chrome extension intercepts and redirects each subresource
        │
        ▼
   Replay server  ──>  reads from $DATA/<domain>/...  ──>  responds with the archived bytes
```

## Verifying it's up

```bash
curl -I http://localhost:5051/replay/20180101120000/https://example.com/
```

You should get a `200`, `301`/`302`, or `404` (not "connection refused").

## Pitfalls

- The replay server **must use the same `--data-folder`** as the admin
  server and CLI.
- Without the extension, you'll see broken images and missing CSS even
  though the main HTML loads fine. That's expected.
- HTTPS is not supported — replay is plain HTTP on `localhost`.

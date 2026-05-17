# FAQ

### Does it need internet to replay?

No. Once the CLI has downloaded the content, replay is fully local. The
Chrome extension prevents your browser from reaching the live web for
subresources. The only exceptions are the small CDN/font allowlist in the
extension (jsDelivr, cdnjs, Google Fonts) which still load from the live
internet — disable them in
[extension/chrome/background.js](../extension/chrome/background.js) if you
want strict offline replay.

### Can I run it without the Chrome extension?

The replay server itself runs fine without the extension, but pages with
absolute-URL subresources will look broken because your browser will fetch
those subresources from the live web. For anything beyond static HTML, you
need the extension.

### Does it work on Firefox?

Not currently. The extension uses Chrome's MV3 `declarativeNetRequest`
which Firefox supports only partially. Patches welcome.

### Where is the data stored?

In one folder. SQLite database (`archive.sqlite` + WAL files) plus
content-addressed asset blobs. See
[configuration.md → data folder layout](configuration.md#data-folder-layout).

### Can I have multiple data folders?

Yes — just point each backend process at the one you want. They don't share
state and don't know about each other.

### How big does the database get?

Linear in the number of CDX entries plus the size of all downloaded bodies.
The metadata overhead per entry is small (a few hundred bytes). Asset
storage is content-addressed: identical bodies across snapshots are stored
once.

### Can it download in parallel across domains?

Yes — pass multiple `--domain` flags or use `--all`. Concurrency
(`--concurrency`) is global across all targeted domains.

### Does it follow redirects?

The downloader resolves redirect chains and records each hop as a separate
request, marking redirect targets so the replay server can 302 to the
canonical version automatically.

### Does it support pywb?

Yes. Use `--cdx-strategy json_pywb` and point `--cdx-base-url` and
`--replay-base-url` at your pywb collection. See [cli.md](cli.md#examples).

### Can I expose this on a public host?

It's designed for local use — there's no auth on the admin or replay
servers, and the Chrome extension's rules are scoped to requests
originating from `localhost`. Exposing as-is is dangerous. If you must,
put both servers behind an authenticating reverse proxy and update
`APP_HOST` in [config.ts](../backend/src/config.ts) plus the extension
constants.

### Can I share a search with someone else?

The search and its results live in the data folder. If you ship the folder
to another machine they'll see the same searches and reactions.

### How do reactions work technically?

A reaction is a (resource_version, reaction_type) row in the database.
Toggling adds or removes the row. The reaction types are configured in the
schema (defaults: 👍, ⭐).

### Why does the CLI need a rate limit?

To be a good citizen of the upstream archive. Defaults are intentionally
not set so you have to make an informed choice. Use a proxy file plus a
modest per-proxy limit to scale safely.

### What's a "run"?

One invocation of `npm start`. Every database row created during a run is
tagged with its UUID. The **Runs** page surfaces this. Useful for auditing
and rollback investigation.

### What's a "resource version"?

A snapshot of a normalized URL at a specific CDX timestamp. The same URL
captured five times yields five versions, each with its own download
attempt and status.

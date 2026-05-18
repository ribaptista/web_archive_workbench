# Importing from a pywb server

You can point `web_archive_workbench` at any [pywb](https://github.com/webrecorder/pywb)
instance (local or remote) instead of the public Wayback Machine. This is
useful when you want to capture pages yourself and then ingest them into
your workbench archive.

## 1. Run a pywb server

The quickest way is via the official Docker image:

```bash
docker pull webrecorder/pywb

docker run \
  -e INIT_COLLECTION=my-archive \
  -p 8080:8080 \
  -v /path/in/host/machine/archives:/webarchive \
  webrecorder/pywb \
  wayback --record --live -a --auto-interval 10
```

This starts pywb on `http://localhost:8080` with a writable collection named
`my-archive`. The `--auto-interval 10` flag tells pywb to rebuild its CDX
index every 10 seconds so new captures become discoverable quickly.

## 2. Record some pages

Open a browser and visit the record endpoint for the pages you want to
capture:

```
http://localhost:8080/my-archive/record/https://example.org
```

> **Note:** the `web_archive_workbench` Chrome extension skips requests to
> `http://localhost:8080` by default so it won't interfere with recording
> against a local pywb running on that port. If you run pywb on a
> different host or port, edit `PYWB_SERVER_ORIGIN` in
> [extension/chrome/background.js](../extension/chrome/background.js) to
> match (for example `http://localhost:9090`). Reloading the extension may not
> be enough — remove the extension from `chrome://extensions` and add it
> back (Load unpacked) for the change to take effect.

Wait ~10 seconds after the page finishes loading so pywb's auto-indexer
picks up the new WARC entries.

## 3. Import into web_archive_workbench

Run the CLI pointing at your pywb collection's CDX and replay endpoints,
and using the `json_pywb` strategy:

```bash
npm start -- \
  --data-folder /path/to/data \
  --concurrency 10 \
  --max-req-per-second 10 \
  --domain example.org \
  --cdx-base-url http://localhost:8080/my-archive/cdx \
  --replay-base-url http://localhost:8080/my-archive/ \
  --cdx-strategy json_pywb
```

The CLI will fetch the CDX index for `example.org`, register each snapshot
in the database, and download each body via your pywb server.

For a remote pywb instance, replace `http://localhost:8080` with the
server's public URL.

## Notes and limitations

- **No pagination.** The `json_pywb` sync strategy never paginates: it
  fetches the entire CDX index for the domain in a single request. For
  very large collections this can be slow or memory-heavy; consider
  splitting captures across multiple collections.
  Supporting pagination against pywb servers with zipnum indexes is a TODO.
- **`--cdx-page-size` is ignored** by the `json_pywb` strategy in practice
  because pywb returns the full result set at once.
- **Time filters** (`--cdx-from` / `--cdx-to`) are still honored — pywb
  applies them server-side.

## Related

- [CLI reference](cli.md) — full list of CLI arguments.
- [Configuration](configuration.md) — environment-variable equivalents.

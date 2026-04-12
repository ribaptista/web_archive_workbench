# Wayback Downloader

A set of scripts to bulk-download websites from the [Internet Archive Wayback Machine](https://web.archive.org), inspect the results, and produce rendered snapshots.

---

## Downloading websites

Start a bulk download by passing a list of domains:

```sh
npm start -- --domains \
  example.com \
  example.org \
  example.net \
  --output ../wayback \
  --db ../wayback/wayback.db \
  --max-req-per-second 1 \
  --concurrency 100 \
  --proxy-file ./proxies.txt
```

Downloaded files are stored under `--output` and indexed in the SQLite database specified by `--db`.

---

## Retrying errored entries

After the first run, some URLs may have failed. To retry them, collect the `cdx_file` IDs from the database (table `cdx_file`, column `id`) and pass them to `--retry-errors`:

```sh
npm start -- --retry-errors \
  e57cb121-1f2a-428c-a7e9-045e69203fab \
  db083a37-2e1a-4cc9-9231-c00cbcb37527 \
  99b6b42e-9bb5-44de-accd-95035bf4916c \
  --output ../wayback \
  --db ../wayback/wayback.db \
  --max-req-per-second 1 \
  --concurrency 100 \
  --proxy-file ./proxies.txt
```

This retries every CDX entry from the provided CDX files for which no successfully completed request exists — i.e. entries with no row in the `request` table, or entries where every associated request has at least one row in `request_errors`.

> **Note:** Entries that previously failed with errors such as `missing_original_headers` or `redirect_limit_exceeded` will likely fail again with the same error. These can be considered non-retryable.
> **TODO:** Add an option to skip known non-retryable error codes.

After each retry run, check the output summary for the number of newly succeeded entries. If at least one new entry succeeded, it is worth running the retry script again — some URLs time out on first attempts but eventually resolve. Others consistently time out and will never succeed regardless of retries.

---

## Inspecting downloaded files

Downloaded URLs are stored as symlinks pointing to content-addressed files in the `assets` directory. File browsers such as Finder do not handle symlink trees well. Use the `resolve-symlinks` script to produce a copy of the download tree with all symlinks replaced by their actual file contents:

```sh
npx ts-node src/resolve-symlinks.ts ../wayback ../wayback_resolved
```

---

## Searching through downloaded HTML files

To find all files containing a search term (works with symlinks):

```sh
find -L . -type f -exec grep <search_term> -il {} + > urls.txt
```

This produces a list of file paths, one per line, saved to `urls.txt`.

---

## Advanced search: deduplicating similar files

The raw search results above may contain many near-duplicate pages. Use `grep-context` to reduce the list to only files with unique context around each match.

For each file, the script finds all occurrences of the search term along with a 1024-character context window before and after it, concatenates all matches, and computes a SHA-256 digest. Only the first file per unique digest is kept.

```sh
cat urls.txt | npx ts-node src/grep-context.ts <search_term> > unique_contexts.txt
```

---

## Generating an HTML index for inspection

Given a filepath list (e.g. `unique_contexts.txt`), use `dedup-html` to generate an HTML file with `file://` links to each file. The script also deduplicates the list, keeping only files with unique content digests (based on the `.{43}` digest embedded in their filenames).

Output one filepath per line (default):
```sh
cat unique_contexts.txt | npx ts-node src/dedup-html.ts > selected.txt
```

Output an HTML file with clickable links:
```sh
cat unique_contexts.txt | npx ts-node src/dedup-html.ts --html > index.html
```

Open `index.html` in a browser to browse the matching files directly from the filesystem.

---

## Browsing pages via the Wayback Machine

Use the `server` script to start a local web server that renders an HTML page with links to the original archived pages on the Wayback Machine. This is useful for viewing pages as they were fully rendered at the time of archiving.

```sh
npx ts-node src/server.ts selected.txt ../wayback/wayback.db
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

> The server resolves each file's content digest against the database to retrieve the original URL and snapshot timestamp, and constructs the corresponding `https://web.archive.org/web/<timestamp>/<url>` replay link.

---

## Downloading pages as MHTML

Use the `mhtml-downloader` script to download fully rendered Wayback Machine pages and save them locally as MHTML (embedded web archive format). This uses a headless Chromium browser via Puppeteer.

```sh
npx ts-node src/mhtml-downloader.ts selected.txt ../wayback/wayback.db ./mhtml --concurrency 1
```

- Each page is saved as `<output-dir>/<encoded-original-url>_<timestamp>_<cdxEntryId>_<bodyDigest>.mhtml`
- Already downloaded files are skipped automatically
- Press `Ctrl+C` to stop gracefully — in-flight downloads will finish before the process exits
- A summary of succeeded and failed downloads is printed at the end

# Wayback Downloader

A set of scripts to bulk-download websites from the [Internet Archive Wayback Machine](https://web.archive.org), inspect the results, and produce rendered snapshots.

## Disclaimer

This project is intended to operate in good faith within the Internet Archive’s published guidelines for automated access.

**If any aspect of this tool is found to be incompatible with those guidelines or causes unintended operational impact, the maintainer will review and take appropriate corrective action, including modification or removal of the repository if necessary.**

This tool retrieves archived web data from the Internet Archive’s Wayback Machine using its official interfaces, including CDX index APIs and playback endpoints provided by the service.

It does not use URL guessing, crawling circumvention techniques, proxy rotation, or any methods intended to bypass rate limits, access controls, or intended usage patterns. The design goal is to support transparent, research-oriented access consistent with the fair and responsible use of the Wayback Machine’s infrastructure.

The tool may perform **bounded archival reconstruction on a per-domain basis**, meaning it can retrieve all available archived captures for a given domain when requested. This is done at low request rates, without concurrency amplification or retry-driven load patterns, and is intended to remain within typical research-scale usage as described in the Internet Archive’s published guidelines (including rate limiting, polite automation, and non-abusive access expectations).

Users are expected to respect the Internet Archive's servers by following reasonable rate limits, concurrency limits, and non-abusive usage patterns. The tool includes conservative defaults and enforces hard caps on request rate and concurrency to help reduce load and encourage responsible use.

All data retrieved through this tool is stored locally on the user’s machine. The authors of this project do not host, store, transmit, or control any downloaded content after retrieval. Users are solely responsible for managing, securing, and using locally stored data in compliance with applicable laws and regulations.

All archived content remains the property of its respective copyright holders. This project does not grant any rights or licenses to third-party content accessed via the Wayback Machine.

Users are responsible for ensuring their use of this tool and any retrieved data complies with applicable laws, copyright restrictions, and the Internet Archive’s terms of use.

Not affiliated with or endorsed by the Internet Archive.


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

> **Note: proxy instability after `NGHTTP2_INTERNAL_ERROR`**
> When using a proxy from proxyscape.com, if a request fails with the upstream error `Stream closed with error code NGHTTP2_INTERNAL_ERROR`, subsequent requests through the same proxy — even to different upstream URLs — may immediately fail with `connect ECONNREFUSED`. The cause is unknown, but the proxy appears to need time to recover. In these cases, reducing the request rate (e.g. `--max-req-per-minute 1`) gives the proxy time to recover between requests.

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

To skip entries that previously failed with specific error codes (treating them as if they succeeded), use `--skip-error` (repeatable). To skip by a substring of the error message instead, use `--skip-error-message` (repeatable). Both flags can be combined:

```sh
npm start -- --retry-errors \
  e57cb121-1f2a-428c-a7e9-045e69203fab \
  --output ../wayback \
  --db ../wayback/wayback.db \
  --max-req-per-second 1 \
  --concurrency 100 \
  --proxy-file ./proxies.txt \
  --skip-error missing_original_headers \
  --skip-error redirect_limit_exceeded \
  --skip-error-message "timed out"
```

Entries whose only errors all match at least one `--skip-error` code or `--skip-error-message` substring will not be retried.

> **Note:** Entries that previously failed with errors such as `missing_original_headers` or `redirect_limit_exceeded` will likely fail again with the same error. Use `--skip-error` to exclude those known non-retryable codes.

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
find -L ./wayback/<domain> \
  -path ./wayback/<domain>/assets -prune -o \
  -path ./wayback/<domain>/raw_responses -prune -o \
  -type f -exec grep -ilE "<search_pattern>" {} + \
  > results.txt
```

This produces a list of file paths, one per line, saved to `urls.txt`.

> **Note:** `grep` matches one line at a time. If the desired string is split across multiple lines in the HTML source (e.g. a tag attribute wraps onto the next line), `grep` will not find it. In that case, use a tool that can match across lines, or pre-process the files to join lines before searching.

> **Note:** When dealing with old webpages that may not be valid UTF-8, prefix the command with `LC_ALL=C` to prevent `grep` from failing on non-UTF-8 bytes. This is only safe when the search term consists of simple ASCII characters (`[a-zA-Z0-9]` and basic special characters):
> ```sh
> LC_ALL=C find -L ./wayback/<domain> \
>   -path ./wayback/<domain>/assets -prune -o \
>   -path ./wayback/<domain>/raw_responses -prune -o \
>   -type f -exec grep -ilE "<search_pattern>" {} + \
>   > results.txt
> ```
>
> If you pipe the result into a second `grep`, `LC_ALL=C` must be set for that invocation too — the inline assignment only applies to the command it prefixes, not to subsequent commands in the pipeline. The simplest fix is to export it first:
> ```sh
> export LC_ALL=C
> find -L ./wayback/<domain> \
>   -path ./wayback/<domain>/assets -prune -o \
>   -path ./wayback/<domain>/raw_responses -prune -o \
>   -type f -exec grep -ilE "<search_pattern>" {} + \
>   | grep -iE "<another_term>" \
>   > results.txt
> ```

---

## Filtering paths by include/exclude terms

Given a list of file paths, use `filter-paths` to keep only files that contain at least one line matching an include term but not an exclude term (case-insensitive). Terms with spaces or special characters are supported via quoted arguments.

```sh
cat urls.txt | npx ts-node src/filter-paths.ts --include "search term" --exclude "unwanted term" > filtered.txt
```

Options:
- `--include` / `-i`: a file is kept if at least one line contains this term
- `--exclude` / `-e`: lines that also contain this term are ignored
- `--charset` / `-c`: character set to read files with (required)

> **Note:** When working with old webpages, files may not be valid UTF-8. In that case, use `--charset latin1` to avoid decoding errors. This is only safe when the search term consists of simple ASCII characters (`[a-zA-Z0-9]` and basic special characters), as `toLowerCase()` matching for non-ASCII characters is unreliable under `latin1`:
> ```sh
> cat urls.txt | npx ts-node src/filter-paths.ts --charset latin1 --include "search term" --exclude "unwanted term" > filtered.txt
> ```

---

## Subtracting a known file list

Given two filepath lists, use `subtract-paths` to output only entries from the pipe that are not present in a reference file. Comparison is based on the 43-character content digest embedded in each filename.

```sh
cat all.txt | npx ts-node src/subtract-paths.ts already-seen.txt > new-only.txt
```

Paths in the reference file that have no recognisable digest are reported to stderr and skipped.

---

## Advanced search: deduplicating similar files

The raw search results above may contain many near-duplicate pages. Use `grep-context` to reduce the list to only files with unique context around each match.

For each file, the script finds all occurrences of the search term along with a 1024-character context window before and after it, concatenates all matches, and computes a SHA-256 digest. Only the first file per unique digest is kept.

```sh
cat urls.txt | npx ts-node src/grep-context.ts <search_pattern> > unique_contexts.txt
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

Sort the deduplicated list lexicographically before output (works with or without `--html`):
```sh
cat unique_contexts.txt | npx ts-node src/dedup-html.ts --sort > selected.txt
cat unique_contexts.txt | npx ts-node src/dedup-html.ts --sort --html > index.html
```

Open `index.html` in a browser to browse the matching files directly from the filesystem.

---

## Browsing pages via the Wayback Machine

Use the `server` script to start a local web server that renders an HTML page with links to the original archived pages on the Wayback Machine. This is useful for viewing pages as they were fully rendered at the time of archiving.

```sh
npx ts-node src/server.ts \
  --file-list selected.txt \
  --db ../wayback/wayback.db \
  --locale utf8
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

Options:
- `--file-list` / `-f`: path to the file list (required)
- `--db` / `-d`: path to the SQLite database (required)
- `--locale` / `-l`: character set used when reading files, e.g. `utf8` or `latin1` (required)
- `--pattern` / `-p`: regular expression to search for in each file (repeatable, case-insensitive)

When `--pattern` is supplied, the HTML page shows matching lines grouped under each pattern before the replay link:

```sh
npx ts-node src/server.ts \
  --file-list selected.txt \
  --db ../wayback/wayback.db \
  --locale latin1 \
  --pattern "search term" \
  --pattern "\d{4}-\d{2}-\d{2}"
```

Each `<li>` in the rendered page contains a two-level match list — one item per pattern, with the matching lines nested beneath it — followed by the Wayback Machine replay link.

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


## Known issues

X When replaying urls that originally returned 3xx + location: replay the redirect response instead of serving the page directly
  X `../wayback/locost.eng.br/http%3A/%2F/%2Fwww.locost.eng.br/%2Fvisuh/%2Ffotos/%2F_20060524022356_120_633720_Zm_txgsZSYohXhattZJfGIHOh-WA6aOP_n9j8aGi6As.html`
  X `http://localhost:3000/replay/20070830014542/http://www.valhalla.com.br:80/`
X Clicking on a wayback url in url list triggers extension rewrite
X Investigate why this page doesn't set the background image and why other requests fail
  X `http://localhost:3000/replay/20200806182043/http://www.valhalla.com.br/website/annihilator-for-the-demented/`
  X try again after refreshing index (see missing url below)
* 20060911052119	http://www.novometal.com:80/thebandsarena/topbandasin.php?ilink=DewScented/DewScented.php&ibanda=Dew+Scented
* 847476 - 20081028225352	http://www.hellionrecords.com:80/
  redirets to another url -> 404
  instead, show 200 versions of 847476

## TODO

* Download additional domains
  * from "press" page
  * .com domain of a news website (roadiecrew.com?)
* retry failed downloads (XII.jpg)
* Refresh cdx index
  X not found in db: `http://www.valhalla.com.br/website/wp-content/plugins/simple-responsive-slider/assets/css/responsiveslides.css?ver=4.7.18`
  * run for all domains
X domain allow list:
  X google fonts
  X cdn (jquery?)
X show similar results
* show 404s/errors in extension console
X sync
* skip rows with unexpected field values
* clean up errors from db
* sanity check (db <-> filesystem)
* recreate db with FK
* detect indexes to be created (lookup for sync)
* detect url resolving to multiple cdx entries?
* versions
  - show similar path/relaxed domain
* non-ascii chars in url
  http://brasilmusicpress.com:80/clientes/sagitta/fotos-alta/DivulgaÐ·Ð³o%201.jpg
  http://brasilmusicpress.com:80/clientes/sagitta/fotos-alta/DivulgaÐ·Ð³o%201_thumb.jpg
* multiple successful requests for a cdx_entry? prevent
  - handle concurrent download runs for same domain (race creating symlinks + setting successful_terminal_request_id)
* report outdated query result (more files arrived)
X multithread search
X id -> uuid -> insert only after filesystem operations complete
X rockbrigade -> slow -> change queries to use fields current=true, is_successful_terminal
* paginate cdx? microsoft.com
* paginate pending downloads
* Scanning directory: /Users/ricardo/wayback/carcasse.com/http%3A/%2F/%2Fwww.bloddy_kisses.blogger.com.br
  Scanning directory: /Users/ricardo/wayback/carcasse.com/http%3A/%2F/%2Fwww.bloodmovies.com
  Scanning directory: /Users/ricardo/wayback/carcasse.com/http%3A/%2F/%2Fwww.blueblood.net
  Scanning directory: /Users/ricardo/wayback/carcasse.com/http%3A/%2F/%2Fwww.bmezine.com
  Scanning directory: /Users/ricardo/wayback/carcasse.com/http%3A/%2F/%2Fwww.bokadoinferno.hpg.ig.com.br
  Scanning directory: /Users/ricardo/wayback/carcasse.com/http%3A/%2F/%2Fwww.bokadoinferno.hpg.ig.com.br/%2Fromepeige
  Scanning directory: /Users/ricardo/wayback/carcasse.com/http%3A/%2F/%2Fwww.bokadoinferno.hpg.ig.com.br/%2Fromepeige/%2Fhorrogot
    X https://web.archive.org/web/20040107080701id_/http://links.carcasse.com:80/out.php?id=399 redirects to https://web.archive.org/web/20040107080701id_/http://darksep.cjb.net/
    X shouldn't be an issue
    * mention in readme that searching inside carcasse.com will include these domains
X domain id instead of literal
* pastore AND ricardo
X domain combobox instead of text - in new search and rearch results
  X multiple buttons instead of combobox
X filter conditions in search results
X result order
X duplicate results: http://localhost:5050/search_results?search_id=7
* latin/utf8
* option: regex/literal
* compare two searches (subtract)
* stop/slow down on 429/503?


TODO
- request + 302 -> may redirect to page inside domain but not on cdx file
  - what is displayed in the tree -> cdx entry or request?
  - which is selected for search?
- save mimetype in request table
X remove old cdx_id from cdx_entry table
X script to generate htmlparser stream from existing html files
  X ndjson:
    {type:a, n:"attr name", v:"value"}
    {type:t, v:"value in latin1"}
- change downloader to generate htmlparser stream for each downloaded html file
~ support for scan strategies: htmlparser stream or plain text
  - save strategy in search db row
  - common
    X filter only html mimetypes
    - read text stream in moving windows (2KB)
    - save window size to search parameters
    - save match offset in match db row instead of literal match text
      - match source type: attribute or text
      - attribute case: attribute index
      - text case: char offset
    - match display in search results:
      - attribute matches (as pills)
      - text match
      X highlight multiple occurrences inside snippet
- Set both context_digest and body_digest in reaction
- identify more errors types (instead of generalizing to general)
- page to list all reacted urls
  - filters:
    - reaction
    - domain
    - condition?
- script to set field last_errored_request in cdx_entry
- modify downloader to set last_errored_request
- include counts besides domain/condition/reaction
- add select all/none to toggles/checkboxes
- change reaction filter behavior in search result
  - include "no reaction"
- create derived search
- add "junk" and "seen check" reactions
- reaction manager (crud)
- replace reaction buttons (emoji) with tags (pills)
- create website tree browser
  - start at domains
    - one level per `/`
  - create script to update cdx_entry to add parent_id
  - change downloader to set parent_id
  - tree browser controller
  - show # duplicates, # successful versions, # errored versions, # redirect versions, # pending download versions
- domain inspector
  - list domains
  - domain details
    - stats
      - # entries
      - # successful
      - # errors
      - # pending download
    - runs 
      - list runs with detail:
        - timestamp
        - parameters: skip error code/message
        - # cdx entries created
        - # successful downloads
        - # errors
          - by type
        - completed?
* version (timestamp) selector overlay
  * show error / 302 / ok / not downloaded / digest
* https://www.metalrevolution.net/blog/2018/06/14/pastore-confira-lyric-video-da-musica-phoenix-rising/
  broken chars?



- search scan sql optimization


- error spliting `/`: http://www.laudany.com.br/erros/404.htm?404;http:
  http://localhost:5050/resources?path=http%3A%2F%2Fwww.laudany.com.br%2Ferros&level=1

- access replay from resources
- http://localhost:5050/list_versions?url=http%3A%2F%2Ferror.hostinger.eu%2F
  redirecting to external?
X http://localhost:3000/replay/20181224103750/https://www.hostinger.com.br/free-eol?utm_source=fri&utm_medium=www&utm_campaign=free_eol
  all pending?
- http://localhost:5050/list_versions?url=http%3A%2F%2Flaudany.com.br%2Frobots.txt ->
20170722110655
redirect
→ http://error.hostinger.eu/
- http://localhost:3000/replay/20170923133637/http://error.hostinger.eu/ -> 
  redirects to live website -> not being rewritten?
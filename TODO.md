# TODO

## Clean up

- [ ] Remove unused modules from package.json in both frontend and backend
- [ ] Review DB indexes (missing and unused)
- [ ] Set up linter in backend app
- [ ] Fix lint errors in frontend app
- [ ] Fix race issues in all network requests from frontend to admin server
- [ ] Set a custom User-Agent header for outgoing HTTP requests
- [ ] Set up CLI args parsers to error on unknown arguments

## Known issues

- [ ] Delete search request returns 500
- [ ] Original URLs containing non-UTF-8 bytes resolve to a nonexistent URL on replay:
  - True original (bytes on the wire): `http://www.thorns.com.br:80/HTM_Esoterico/HTM_Cristais/CristaisProgramação.htm`, where `ç` and `ã` are encoded as ISO-8859-1 (`%E7`, `%E3`).
  - Percent-encoded form `...cristaisprograma%e7%e3o.htm` works against the replay server.
  - The CDX response decodes those bytes as if they were UTF-8, producing mojibake: `...CristaisProgramaÐ·Ð³o.htm`.
  - Re-encoding that mojibake yields `...CristaisPrograma%C3%90%C2%B7%C3%90%C2%B3o.htm`, which the replay server cannot find.
  - Another example: `http://brasilmusicpress.com:80/clientes/sagitta/fotos-alta/DivulgaÐ·Ð³o%201.jpg`
- [ ] Local replay server crashes when attempting to serve a resource referenced by `http://localhost:5051/replay/20171017081900/http://metalrevolution.net:80/blog/2017/10/10/pastore-confira-capa-e-track-list-de-novo-album-phoenix-rising/`
  - `TypeError: Invalid character in header content ["location"]`
- [ ] Implement case-insensitive fallback normalized URL matching in replay server
  - Example: `http://localhost:5051/replay/20040208134602/http://www.novometal.com:80/TheBandsArena/topbandasin.php?ilink=DewScented/DewScented.htm&ibanda=Dew+Scented` redirects to `http://localhost:5051/replay/20041108150921/http://novometal.com/thebandsarena/topbandasin.php?ilink=DewScented/DewScented.htm&ibanda=Dew+Scented`, which in turn redirects to `http://localhost:5051/replay/20041108150921/http://novometal.com/thebandsarena/DewScented/DewScented.htm`
  - There is neither an exact match for the last URL above, nor a matching normalized URL with that casing, so the replay server responds with 404
  - But there is a resource in the DB with normalized URL `.../TheBandsArena/...`, which could be a match for this request
  - It seems Wayback Machine's replay server is case insensitive
- [ ] Incorrect relative paths in original HTMLs that ascend past the site root break absolute URLs
  - Example: `http://localhost:5051/replay/20110823112442/http://www.gothznewz.com.br:80/` contains a frame that incorrectly points to `../news.html`, resulting in the browser requesting `http://localhost:5051/replay/20110823112442/http://news.html`
- [ ] Deleting large search results takes too long
  - While the deletion operation is in progress, the app becomes unresponsive
- [ ] The query at the start of a search task takes too long to fetch the count of html candidates
  - Instead, scan for candidates in batches and update the total count on each batch
- [ ] Make replay server ignore scheme (http/https) when looking for the exact match for a URL
  - Example: `http://localhost:5051/replay/20190320080604/https://www.carcasse.com/revista/pesadelar/pintura_gotica/index.php` resolves to a version with a much more recent timestamp (from 2024) because it is the only one that matches the https scheme, even though there are versions close to the requested one (2019) with the exact same domain and path, except their scheme is http.
- [ ] Progress bar reaches an inconsistent state

```
[downloads] |████████████████████████████████████████| 60223/60038 | succeeded: 59928 | failed: 295 | cdx scanned: 151951 | new: 0 | ETA: 0s
```

- [ ] Resources under subpaths are unreachable from the resources list page when the parent path is also a resource
  - Example: the directory `http://localhost:3000/resources?path=carcasse.com%2Frevista&level=1` is unreachable from `http://localhost:3000/resources?path=carcasse.com&level=0`, since the entry `carcasse.com/revista` points straight to versions of page `carcasse.com/revista`
  - Another example: `http://localhost:3000/resources?path=locost.eng.br%2Fvisuh%2Ffotos&level=2` is unreachable because `locost.eng.br/visuh/fotos` points to a resource in the `locost.eng.br/visuh` resource list

## New features

- [ ] Search results become stale (new files have been downloaded for the domains covered by the search since the search results were generated)
  - Refresh search (run search on new files and append matches to the existing results)
  - Implement sorting by download date (to help the user identify new matches)
- [ ] Stop/slow down requests to CDX/replay servers on 429/5xx
- [ ] Add `cdx_sync_complete` and `download_complete` to each run entry in runs page
- [ ] Add reaction buttons to resource versions page
- [ ] Refactor error page to support listing errors from all domains
- [ ] Support `AND` search conditions
- [ ] Implement command to optimize DB storage by removing errored requests not referenced by `resource_version.last_errored_request_id`
- [ ] Support date range filtering on search submission page and on search results page
- [ ] Support domain deletion (along with dependent entities - `resource`, `resource_version`, `resource_version_source`) while keeping pre-computed counters consistent
- [ ] Support filtering by path prefix in downloader CLI
  - Example: the page at `http://localhost:5051/replay/20050127045248/http://metalrevolution.net:80/` includes frames that point to a website that loads resources hosted in `geocities.yahoo.com.br/adesite`, `www.geocities.com/adesite` and `br.geocities.com/adesite`

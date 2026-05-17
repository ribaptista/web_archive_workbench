# Frontend (Admin UI)

The frontend is a Next.js app served at `http://localhost:3000`. It is the
primary interface for everything except the actual downloading.

```bash
cd frontend
npm run dev    # development
# or
npm run build && npm start  # production
```

## Top navigation

The header always shows six links:

| Link           | Path              | What it's for                              |
| -------------- | ----------------- | ------------------------------------------ |
| **New Search** | `/search_form`    | Start a regex search.                      |
| **Searches**   | `/searches`       | List of all past and running searches.     |
| **Runs**       | `/runs`           | History of CLI downloads with stats.       |
| **Resources**  | `/resources`      | Tree browser of every downloaded resource. |
| **Domains**    | `/domains`        | Per-domain counts and error drill-down.    |
| **Reactions**  | `/reactions_view` | Files you tagged "Like" / "Review later".  |

Visiting `/` redirects to `/search_form`.

---

## Page reference

### `/search_form` — New Search

**Purpose:** kick off a regex search over all downloaded HTML/text bodies.

**Actions:**

- Enter one or more **regex conditions**. Standard JavaScript regex syntax.
- Optionally add a **"Not nearby"** regex per condition. Matches whose
  context window also satisfies this pattern are filtered out.
- Add/remove conditions with **+ Add condition** / **Remove**.
- Tick which **domains** to scan. All domains are selected by default.
- Click **Run Search**.

**Result:** You're redirected to `/search_results?search_id=<n>` with live
progress.

**Warnings:**

- Regex is validated client-side before submission.
- A search scans every HTML file across the selected domains — large
  archives may take minutes.

---

### `/searches` — All Searches

**Purpose:** list every search ever created, with current status.

**You see:** a card per search showing:

- ID, creation time, status badge (`pending`, `running`, `done`, `error`).
- Domains and regex conditions used.
- A progress bar for running searches.
- Match count for completed searches.

**Actions:**

- **View results** — go to `/search_results?search_id=<n>`.
- **Delete** — remove the search and its matches (requires confirmation).
- **Auto Refresh** — when any search is running, a toggle appears that
  refreshes the list every 3 seconds.

---

### `/search_results` — Search Results

**Purpose:** inspect matching files for one search.

**Layout:**

- Top: search metadata, status, progress bar.
- Filters panel:
  - Filter by **domain** (subset of the search's domains).
  - Filter by **condition** (any of the search's regexes).
  - Filter by **reaction** (only files with a given reaction).
- Results: one card per file containing:
  - URL + timestamp + a link that opens it in the replay server.
  - Context windows highlighting the regex matches.
  - Reaction buttons (Like, Review later, …).
  - A "Similar files" indicator when duplicate context digests exist.

**Pagination:** cursor-based; **Prev** / **Next** buttons; "Similar files"
opens a focused page showing files with the same content digest.

**Common actions:**

- Click a context window's link to open the archived page in the replay
  server.
- Click reaction icons to flag files.
- Apply filters with **Apply filters**.

**Notes:**

- For running searches, results stream in. Toggle **Auto Refresh**.
- Some files are flagged "duplicate context" — they share content with
  another file already shown.

---

### `/runs` — Runs

**Purpose:** review past CLI download runs.

**Each card shows:**

- Run ID and creation time.
- The CLI flags used.
- Counts: new CDX entries, requested, downloaded, errors.
- Per-domain breakdowns when more than one domain was processed.
- Per-error-type breakdowns (e.g. `5xx: 12`, `ETIMEDOUT: 3`).

Read-only. Use [`/domain_errors`](#domain_errors--domain-errors) to drill into
individual errors.

---

### `/domains` — Domains

**Purpose:** at-a-glance counts per domain.

**Per card:**

- Number of unique resources.
- Number of successfully downloaded entries.
- Number of errored entries (clickable — opens `/domain_errors`).
- Number of pending entries.

---

### `/domain_errors` — Domain Errors {#domain_errors--domain-errors}

**Purpose:** browse failures for one domain.

**Reached from:** the red "errored" badge on `/domains`, or directly with
`?domain=example.com`.

**Features:**

- Filter pills for **error code** and **error name**.
- Apply filters with the button at the bottom of the panel.
- Infinite scroll list of `(url, timestamp, error)` triples.
- Each row shows the error code, name, and message.

**Next step:** re-run the CLI with `--domain example.com --skip-cdx-sync`
to retry these entries.

---

### `/resources` — Resource browser

**Purpose:** tree-style browser of every downloaded URL, grouped by URL
path segments.

**Navigation:**

- Top-level: all domains.
- Click a domain → its first path level.
- Keep clicking to drill down.
- Leaves are marked **resource** and link to `/list_versions`.

**Features:**

- Infinite scroll inside each level.
- Breadcrumb at the top for jumping back up.

---

### `/list_versions` — Versions of one URL

**Purpose:** list every archived snapshot of one specific URL.

**Reached from:** clicking a leaf in `/resources`, or via the Chrome
extension's **List versions** context menu.

**Per row:**

- Timestamp (clickable when the snapshot was successfully downloaded — opens
  the replay server in a new tab).
- Status badge: `ok`, `redirect`, `error`, `pending`.
- For redirects: the destination URL.
- For errors: error code and message.

Infinite scroll loads older versions automatically.

---

### `/reactions_view` — Reactions

**Purpose:** review files you tagged.

**Features:**

- Toggle between reaction types (Like, Review later, …) at the top.
- Filter by domain.
- Standard result cards: replay link, condition badges, context windows,
  and reaction buttons (so you can untag from here).
- Paginated.

---

## Navigating between pages

Typical flows:

- **Find something** → New Search → Search Results → click result to open
  in replay → optionally **Like** it → review from Reactions later.
- **Fix download errors** → Domains → click "errored" → Domain Errors →
  re-run CLI with `--skip-cdx-sync`.
- **Spot-check a URL's history** → Resources → drill in → List Versions →
  click any timestamp.

## Production build

```bash
cd frontend
npm run build
npm start
```

The build is a static Next 16 app. Set `BACKEND_URL` and
`NEXT_PUBLIC_REPLAY_SERVER_URL` (see [configuration.md](configuration.md))
before `npm run build` if you're using non-default ports.

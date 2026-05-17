# Wayback Machine Downloader

A self-hosted toolkit for **downloading, browsing, searching and curating**
archived snapshots from the [Internet Archive's Wayback Machine](https://web.archive.org).

It combines a bulk downloader, a local replay server (so old pages render
properly in your browser), and a web admin UI for regex search, tagging, and
review.

---

## What it does

- **Download** historical snapshots of one or more domains from the Wayback
  Machine, with proxy rotation and rate limiting.
- **Replay** archived pages locally with all assets rewritten to load from
  your own copy — no internet required after download.
- **Search** the entire archive with regular expressions and inspect matches
  with context.
- **Curate** findings with reactions ("Like", "Review later") and a
  resource-tree browser.

## Core concepts

| Concept         | Meaning                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| **Data folder** | A single directory holding `archive.db` (SQLite) and downloaded asset files.   |
| **Domain**      | A site you have downloaded (e.g. `example.com`).                               |
| **Run**         | One invocation of the CLI. Tracks what was requested, downloaded, and errored. |
| **Resource**    | A unique archived URL.                                                         |
| **Version**     | A timestamped snapshot of a resource.                                          |
| **Search**      | A set of regex conditions applied across stored HTML/text bodies.              |
| **Reaction**    | A flag (Like / Review later) attached to a specific URL+timestamp.             |

## Architecture (high-level)

```
                +----------------+
                |  Wayback CDX   |
                +--------+-------+
                         |
                         v
+--------+         +-----+------+         +-----------------+
|  CLI   | ----->  |  archive.db | <----- |  Admin Server   |  (Fastify, :5050)
+--------+         |  + assets/  |        +--------+--------+
                   +------+------+                 ^
                          ^                        | HTTP / fetch
                          |                        |
                  +-------+--------+      +--------+--------+
                  | Replay Server  | <--> |    Frontend     |  (Next.js, :3000)
                  | (Fastify,5051) |      +-----------------+
                  +-------+--------+               ^
                          ^                        |
                          | rewrites every         |
                          | non-replay request     |
                  +-------+--------+               |
                  | Chrome Ext.    |---------------+
                  +----------------+
```

All four backend components share **one data folder** (database +
downloaded files).

## Quick Start (5 minutes)

Prerequisites: **Node.js 20+** and **Chrome/Chromium**.

```bash
# 1. Install dependencies
cd backend  && npm install
cd ../frontend && npm install

# 2. Pick a data folder (will hold archive.db + downloaded files)
export DATA=~/wayback-data
mkdir -p "$DATA"

# 3. Download a small domain (dry-run first to preview)
cd ../backend
npm start -- --data-folder "$DATA" --domain example.com --dry-run
npm start -- --data-folder "$DATA" --domain example.com --max-req-per-second 1

# 4. Start the servers (in separate terminals)
npx tsx src/admin_server/index.ts  --data-folder "$DATA"
npx tsx src/replay_server/server.ts --data-folder "$DATA"

# 5. Start the frontend
cd ../frontend && npm run dev
```

Then:

1. Open **http://localhost:3000** — you should see the **New Search** page.
2. Install the [Chrome extension](docs/chrome-extension.md).
3. From the **Resources** page, drill into a domain and click any version
   timestamp to view the archived page locally.

For a guided walkthrough see **[docs/quick-start.md](docs/quick-start.md)**.

## Documentation

| Topic                                 | Doc                                                  |
| ------------------------------------- | ---------------------------------------------------- |
| Install Node, Chrome, the project     | [docs/installation.md](docs/installation.md)         |
| Configuration & environment variables | [docs/configuration.md](docs/configuration.md)       |
| 5-minute hands-on walkthrough         | [docs/quick-start.md](docs/quick-start.md)           |
| CLI reference & download workflows    | [docs/cli.md](docs/cli.md)                           |
| Admin server                          | [docs/admin-server.md](docs/admin-server.md)         |
| Replay server                         | [docs/replay-server.md](docs/replay-server.md)       |
| Chrome extension setup                | [docs/chrome-extension.md](docs/chrome-extension.md) |
| Frontend pages & features             | [docs/frontend.md](docs/frontend.md)                 |
| End-to-end workflows                  | [docs/common-workflows.md](docs/common-workflows.md) |
| Troubleshooting by symptom            | [docs/troubleshooting.md](docs/troubleshooting.md)   |
| FAQ                                   | [docs/faq.md](docs/faq.md)                           |

## Default ports

| Service       | URL                   |
| ------------- | --------------------- |
| Frontend      | http://localhost:3000 |
| Admin server  | http://localhost:5050 |
| Replay server | http://localhost:5051 |

All three listen on `127.0.0.1` only.

# Installation

## Prerequisites

| Software   | Minimum version | Notes                                           |
| ---------- | --------------- | ----------------------------------------------- |
| Node.js    | 20 LTS          | 22+ recommended.                                |
| npm        | 10              | Bundled with Node.                              |
| Chrome     | 120             | Or any Chromium-based browser with MV3 support. |
| Disk space | Varies          | Plan ~1–5 GB per medium-size domain.            |

Linux, macOS, and Windows (via WSL) are all supported.

## 1. Clone the repository

```bash
git clone <repo-url> wayback_machine_downloader
cd wayback_machine_downloader
```

## 2. Install backend dependencies

```bash
cd backend
npm install
```

This pulls `better-sqlite3` (native), `fastify`, `yargs`, `puppeteer`, and
related tooling.

> **Native build hint** — if `better-sqlite3` fails to install, ensure
> Python 3, `make`, and a C++ toolchain are available (`build-essential` on
> Debian/Ubuntu, Xcode CLT on macOS).

## 3. Install frontend dependencies

```bash
cd ../frontend
npm install
```

## 4. Create a data folder

The data folder holds:

- `archive.db` — SQLite database (created automatically on first run; all
  migrations are applied transparently).
- `<domain>/...` — downloaded asset files, one tree per domain.

```bash
mkdir -p ~/wayback-data
```

You will pass this path as `--data-folder` (or `-b`) to every backend
component.

## 5. Verify the install

```bash
cd backend
npx tsx src/cli/index.ts --help
```

You should see the CLI option list.

## Next step

Continue to **[quick-start.md](quick-start.md)** for an end-to-end run.

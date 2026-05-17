# Installation

## Prerequisites

| Requirement     | Version       | Notes                                          |
| --------------- | ------------- | ---------------------------------------------- |
| Node.js         | ≥ 22          | Backend uses `tsx` to run TypeScript directly  |
| npm             | bundled       |                                                |
| Google Chrome   | recent stable | Required for replay browsing (extension is MV3)|
| Disk space      | varies        | Plan for the total size of assets you'll fetch |

The system is tested on Linux and macOS. Windows users should run via WSL.

## Get the code

```bash
git clone <repo-url> web_archive_workbench
cd web_archive_workbench
```

## Install backend dependencies

```bash
cd backend
npm install
```

This installs Fastify, better-sqlite3, undici, drizzle-orm, vitest, and other
runtime/test deps.

## Install frontend dependencies

```bash
cd ../frontend
npm install
```

This installs Next.js 16, React 19, Tailwind v4, and the Radix-based UI kit.

## Pick a data folder

Create an empty directory that will hold the SQLite database and downloaded
asset blobs:

```bash
mkdir -p ~/wab-data
```

All four backend processes (CLI, admin server, replay server, frontend) must
be pointed at the **same** data folder.

> The SQLite database file inside is named `archive.sqlite`. Asset blobs are
> stored under content-addressed paths derived from their digest.

## Optional: proxy file

If you'll be downloading at scale, you can supply a proxy list to rotate
through. Each line is a single proxy in the form:

```
user:pass@host:port
```

Pass the file path with `--proxy-file`. See [cli.md](cli.md#proxies) for
details. An example file lives at `backend/proxy.txt` (its contents are
sample credentials — replace them with your own).

## Next steps

- Run through the [quick start](quick-start.md).
- Review [configuration](configuration.md) for port and host options.

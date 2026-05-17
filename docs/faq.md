# FAQ

### How is this different from `wayback-machine-downloader` (the gem)?

This project does more than download:

- A **local replay server** rewrites archived HTML so you can browse
  snapshots offline.
- A **web admin UI** for regex search, error triage, reactions, and
  resource browsing.
- A **Chrome extension** that makes replay seamless across all
  subresources.
- Native **proxy rotation** with per-proxy rate limits.

### Where is everything stored?

In one **data folder**:

- `archive.db` — SQLite database (entries, requests, runs, searches, reactions).
- `<domain>/` — downloaded asset files, one tree per domain.

You pass `--data-folder` to the CLI, admin server, and replay server.

### Can I move the data folder?

Yes. The CLI never stores absolute paths inside the DB. Move the folder,
then restart everything with the new `--data-folder`.

### Is there authentication?

**No.** Everything binds to `127.0.0.1`. Don't expose the ports publicly
without putting a reverse proxy with auth in front.

### What happens if I run the CLI twice on the same domain?

Already-downloaded entries are skipped. New CDX entries are merged. It's
safe to re-run on a schedule.

### How large does the database get?

The DB stores metadata only — bodies are on disk. Expect a few MB per
1,000 entries.

### Can I delete a downloaded domain?

Stop the servers, then:

```bash
rm -r $DATA/example.com
sqlite3 $DATA/archive.db "DELETE FROM cdx_entry WHERE domain_name='example.com'; ..."
```

There is currently no UI for full domain deletion.

### Can I search non-HTML content?

The search worker reads any text-like file (HTML and text MIME types).
Binary files (images, video, PDFs) are skipped.

### Does the Chrome extension work in Firefox?

Not as-is. The extension uses Chrome's MV3
`declarativeNetRequest` API. Porting to Firefox is possible but not
included.

### Can I run several CLI downloads in parallel?

Run them with **different domains** if you must, but be aware that they
will compete for write locks on the SQLite database. One CLI per
data-folder is recommended; use higher `--concurrency` to scale.

### How do reactions differ from "favorites"?

Reactions are typed (currently **Like** and **Review later**, defined in
the DB seed). A given URL+timestamp can have multiple reaction types
toggled independently.

### Can I add my own reaction types?

Yes — insert into `reaction_type` directly:

```bash
sqlite3 $DATA/archive.db "INSERT INTO reaction_type (label, icon) VALUES ('Important', 'Star');"
```

Then refresh the frontend. Icon names come from
[lucide-react](https://lucide.dev/icons/).

### Why two servers (admin + replay)?

They have different concerns: the admin server is a JSON API; the replay
server serves rewritten HTML and binary assets and needs different headers
(e.g. `Referrer-Policy: unsafe-url`). Splitting them keeps each simple.

### Can I host the frontend on a different machine?

Yes. Set `BACKEND_URL` and `NEXT_PUBLIC_REPLAY_SERVER_URL` to the public
URLs of the admin and replay servers before building. Put auth in front
of both.

### How do I update?

```bash
git pull
cd backend && npm install
cd ../frontend && npm install
```

Migrations apply automatically the next time you start the admin server,
replay server, or CLI.

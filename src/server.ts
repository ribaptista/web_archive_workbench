import * as http from "http";
import { resolveWaybackEntries, WaybackEntry } from "./resolve-wayback";

const PORT = 3000;

function buildHtml(links: WaybackEntry[]): string {
  const items = links
    .map((l) => `  <li><a href="${l.replayUrl}">${l.filePath}</a></li>`)
    .join("\n");
  return `<!DOCTYPE html>
<html>
<body>
<ul>
${items}
</ul>
</body>
</html>`;
}

function main() {
  const [fileListPath, dbPath] = process.argv.slice(2);
  if (!fileListPath || !dbPath) {
    console.error("Usage: ts-node src/server.ts <file-list-path> <db-path>");
    process.exit(1);
  }

  const links = resolveWaybackEntries(fileListPath, dbPath);
  console.error(`Loaded ${links.length} replay links`);

  const html = buildHtml(links);

  http
    .createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    })
    .listen(PORT, () => {
      console.error(`Listening on http://localhost:${PORT}`);
    });
}

main();

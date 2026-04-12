import * as readline from "readline";
import * as fs from "fs";
import * as crypto from "crypto";

const CONTEXT = 64;

async function main() {
  const args = process.argv.slice(2);

  const searchStr = args[0];
  if (!searchStr) {
    process.stderr.write(
      "Usage: <file-list> | ts-node src/grep-context.ts <search-string>\n",
    );
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin });
  const seenDigests = new Set<string>();

  for await (const line of rl) {
    const filePath = line.trim();
    if (!filePath) continue;

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (e) {
      process.stderr.write(`error reading ${filePath}: ${e}\n`);
      continue;
    }

    const contentLower = content.toLowerCase();
    const searchLower = searchStr.toLowerCase();
    const matchParts: string[] = [];
    let offset = 0;
    while (true) {
      const idx = contentLower.indexOf(searchLower, offset);
      if (idx === -1) break;

      const start = Math.max(0, idx - CONTEXT);
      const end = Math.min(content.length, idx + searchStr.length + CONTEXT);
      matchParts.push(content.slice(start, end));

      offset = idx + 1;
    }

    if (matchParts.length === 0) continue;

    const digest = crypto
      .createHash("sha256")
      .update(matchParts.join(""))
      .digest("base64");

    if (!seenDigests.has(digest)) {
      seenDigests.add(digest);
      process.stdout.write(`${filePath}\n`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

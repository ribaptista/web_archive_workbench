import * as readline from "readline";
import * as path from "path";

const FINAL_PART_REGEX = /.{43}\.[^.]+$/;

async function main() {
  const htmlMode = process.argv.includes("--html");

  const rl = readline.createInterface({ input: process.stdin });

  const seen = new Set<string>();
  const unique: string[] = [];

  for await (const line of rl) {
    const filePath = line.trim();
    if (!filePath) continue;

    const match = filePath.match(FINAL_PART_REGEX);
    if (!match) {
      process.stderr.write(`no match: ${filePath}\n`);
      continue;
    }

    const finalPart = match[0];
    if (!seen.has(finalPart)) {
      seen.add(finalPart);
      unique.push(filePath);
    }
  }

  if (htmlMode) {
    const items = unique.map((filePath) => {
      const absPath = path.resolve(process.cwd(), filePath);
      const href = "file://" + absPath.replace(/%/g, "%25");
      return `  <li><a href="${href}">${filePath}</a></li>`;
    });
    process.stdout.write(`<ul>\n${items.join("\n")}\n</ul>\n`);
  } else {
    for (const filePath of unique) {
      process.stdout.write(`${filePath}\n`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

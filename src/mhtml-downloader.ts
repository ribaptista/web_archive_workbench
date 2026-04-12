import * as fs from "fs";
import * as path from "path";
import puppeteer, { Browser } from "puppeteer";
import pLimit from "p-limit";
import { resolveWaybackEntries } from "./resolve-wayback";

async function downloadMhtml(
  browser: Browser,
  replayUrl: string,
  outputPath: string,
): Promise<void> {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();

  try {
    await page.goto(replayUrl, { waitUntil: "networkidle2", timeout: 60000 });

    const { data } = (await cdp.send("Page.captureSnapshot", {
      format: "mhtml",
    })) as { data: string };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, data, "utf8");
    console.error(`saved: ${outputPath}`);
  } finally {
    await page.close();
  }
}

async function main() {
  const args = process.argv.slice(2);

  const concurrencyIdx = args.indexOf("--concurrency");
  let concurrency = 1;
  if (concurrencyIdx !== -1) {
    concurrency = parseInt(args[concurrencyIdx + 1], 10);
    args.splice(concurrencyIdx, 2);
  }

  const [fileListPath, dbPath, outputDir] = args;
  if (!fileListPath || !dbPath || !outputDir) {
    console.error(
      "Usage: ts-node src/mhtml-downloader.ts [--concurrency N] <file-list-path> <db-path> <output-dir>",
    );
    process.exit(1);
  }

  const entries = resolveWaybackEntries(fileListPath, dbPath);
  console.error(
    `Resolved ${entries.length} entries, concurrency=${concurrency}`,
  );

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    handleSIGINT: false,
    handleSIGTERM: false,
  });

  const limit = pLimit(concurrency);
  let errorCount = 0;
  let aborting = false;

  process.on("SIGINT", () => {
    console.error(
      "\nSIGINT received — finishing ongoing downloads then exiting...",
    );
    aborting = true;
  });

  await Promise.all(
    entries.map(({ filePath, replayUrl, originalUrl, timestamp, cdxEntryId, bodyDigest }) =>
      limit(async () => {
        if (aborting) return;
        const outputPath = path.join(
          outputDir,
          encodeURIComponent(originalUrl) + `_${timestamp}_${cdxEntryId}_${bodyDigest}` + ".mhtml",
        );
        if (fs.existsSync(outputPath)) {
          console.error(`skipping (already exists): ${outputPath}`);
          return;
        }
        try {
          await downloadMhtml(browser, replayUrl, outputPath);
        } catch (e) {
          errorCount++;
          console.error(`error downloading ${replayUrl}: ${e}`);
        }
      }),
    ),
  );

  await browser.close();
  console.error(
    `Done. ${entries.length - errorCount}/${entries.length} succeeded, ${errorCount} error(s).`,
  );
  console.error("Exited cleanly.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

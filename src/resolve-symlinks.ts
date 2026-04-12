import fs from "fs";
import path from "path";

async function resolveAndCopy(inputDir: string, outputDir: string): Promise<void> {
  const entries = await fs.promises.readdir(inputDir, { withFileTypes: true });

  for (const entry of entries) {
    const inputPath = path.join(inputDir, entry.name);
    const outputPath = path.join(outputDir, entry.name);

    if (entry.isDirectory()) {
      console.log(`DIR  ${inputPath}`);
      await fs.promises.mkdir(outputPath, { recursive: true });
      await resolveAndCopy(inputPath, outputPath);
    } else if (entry.isSymbolicLink()) {
      console.log(`LINK ${inputPath}`);
      // Resolve to the real file and copy its contents
      const realPath = await fs.promises.realpath(inputPath);
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.promises.copyFile(realPath, outputPath);
    } else if (entry.isFile()) {
      console.log(`FILE (skipped) ${inputPath}`);
    }
  }
}

async function main(): Promise<void> {
  const [, , inputDir, outputDir] = process.argv;

  if (!inputDir || !outputDir) {
    console.error("Usage: ts-node src/resolve-symlinks.ts <input-dir> <output-dir>");
    process.exit(1);
  }

  const absInput = path.resolve(inputDir);
  const absOutput = path.resolve(outputDir);

  const stat = await fs.promises.stat(absInput);
  if (!stat.isDirectory()) {
    console.error(`Input path is not a directory: ${absInput}`);
    process.exit(1);
  }

  await fs.promises.mkdir(absOutput, { recursive: true });
  await resolveAndCopy(absInput, absOutput);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

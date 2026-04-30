import * as fs from 'fs';
import * as readline from 'readline';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

export function isExclNear(
  excTerm: string,
  lowerContent: string,
  matchStart: number,
  matchEnd: number,
): boolean {
  let pos = 0;
  while ((pos = lowerContent.indexOf(excTerm, pos)) !== -1) {
    const exclStart = pos;
    const exclEnd = pos + excTerm.length;
    if (exclEnd <= matchStart) {
      if (!/[\r\n]/.test(lowerContent.slice(exclEnd, matchStart))) return true;
    } else if (exclStart >= matchEnd) {
      if (!/[\r\n]/.test(lowerContent.slice(matchEnd, exclStart))) return true;
    } else {
      return true; // overlapping
    }
    pos++;
  }
  return false;
}

export function fileMatches(
  includePattern: string,
  excTerm: string,
  content: string,
): boolean | null {
  const lowerContent = content.toLowerCase();
  const lowerExcTerm = excTerm.toLowerCase();

  const re = new RegExp(includePattern, 'gi');
  let anyIncMatch = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    anyIncMatch = true;
    const { index } = match;
    const end = index + match[0].length;
    if (!isExclNear(lowerExcTerm, lowerContent, index, end)) return true;
    if (match[0].length === 0) re.lastIndex++;
  }

  return anyIncMatch ? false : null;
}

if (require.main === module) {
  const argv = yargs(hideBin(process.argv))
    .option('include', {
      alias: 'i',
      type: 'string',
      description:
        'Only keep files that have at least one line containing this term',
      demandOption: true,
    })
    .option('exclude', {
      alias: 'e',
      type: 'string',
      description: 'Skip lines that also contain this term',
      demandOption: true,
    })
    .option('charset', {
      alias: 'c',
      type: 'string',
      description:
        'Character set to use when reading files (e.g. latin1, utf8)',
      demandOption: true,
    })
    .parseSync();

  const charset = argv.charset as BufferEncoding;
  const excTerm = argv.exclude;

  async function main(): Promise<void> {
    const stdinRl = readline.createInterface({ input: process.stdin });

    for await (const line of stdinRl) {
      const filePath = line.trim();
      if (!filePath) continue;

      try {
        const content = fs.readFileSync(filePath, charset);
        const result = fileMatches(argv.include, excTerm, content);
        if (result === null) {
          process.stderr.write(
            `warn: no lines matching --include found in ${filePath}\n`,
          );
        } else if (result) {
          process.stdout.write(`${filePath}\n`);
        }
      } catch (err) {
        process.stderr.write(
          `error reading ${filePath}: ${(err as Error).message}\n`,
        );
      }
    }
  }

  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

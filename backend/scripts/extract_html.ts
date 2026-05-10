import path from 'path';
import { htmlExtractToFiles } from '../src/html';

const [, , inputPath, outputPrefix] = process.argv;

if (!inputPath) {
  console.error('Usage: extract_html.ts <input-html-path> [output-prefix]');
  process.exit(1);
}

const resolvedInput = path.resolve(inputPath);
const resolvedOutput = outputPrefix
  ? path.resolve(outputPrefix)
  : resolvedInput.replace(/\.[^.]+$/, '');

console.log(`Input:  ${resolvedInput}`);
console.log(`Output: ${resolvedOutput}.{text,attrs,comments}`);

async function main() {
  await htmlExtractToFiles(resolvedInput, resolvedOutput);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

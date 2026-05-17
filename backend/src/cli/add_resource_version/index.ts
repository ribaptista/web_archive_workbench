import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { openDatabase, DB_FILENAME } from '../../db/conn';
import { CdxRepository } from '../../cdx/repository';
import { ensureResourceVersionRegistered } from '../../cdx/sync';
import {
  normalizeUrl,
  normalizeDomain,
  equalsOrSubdomain,
} from '../../http/normalized_url';

function parseArgs() {
  return yargs(hideBin(process.argv))
    .option('data-folder', {
      type: 'string',
      description: 'Data folder containing the archive database',
      demandOption: true,
    })
    .option('url', {
      type: 'string',
      description: 'URL of the resource version to add',
      demandOption: true,
    })
    .option('timestamp', {
      type: 'number',
      description: 'Timestamp of the resource version (integer)',
      demandOption: true,
    })
    .option('domain', {
      type: 'string',
      description: 'Domain name the resource version belongs to',
      demandOption: true,
    })
    .parseSync();
}

function main() {
  const argv = parseArgs();

  const dataFolder = path.resolve(argv['data-folder'] as string);
  const rawUrl = argv['url'] as string;
  const timestamp = argv['timestamp'] as number;
  const domain = argv['domain'] as string;

  const normalizedDomain = normalizeUrl(rawUrl).getNormalizedDomain();
  const normalizedTargetDomain = normalizeDomain(domain);

  if (!equalsOrSubdomain(normalizedDomain, normalizedTargetDomain)) {
    throw new Error(
      `URL domain "${normalizedDomain}" is not equal to or a subdomain of "${normalizedTargetDomain}"`,
    );
  }

  const db = openDatabase(path.join(dataFolder, DB_FILENAME));
  const cdxRepo = new CdxRepository(db);

  const inserted = ensureResourceVersionRegistered(
    cdxRepo,
    rawUrl,
    timestamp,
    domain,
  );

  if (inserted) {
    console.log(
      `Inserted new resource_version: url="${rawUrl}", timestamp=${timestamp}, domain="${domain}"`,
    );
  } else {
    console.log(
      `Resource version already existed: url="${rawUrl}", timestamp=${timestamp}, domain="${domain}"`,
    );
  }
}

main();

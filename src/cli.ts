import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'path';

export interface CliArgs {
  domain: string[];
  all: boolean;
  output: string;
  db: string;
  proxyFile: string | undefined;
  maxReqPerPeriod: number | undefined;
  periodMs: number | undefined;
  concurrency: number;
  retryErrors: boolean;
  skipErrors: string[];
  skipErrorMessages: string[];
  dryRun: boolean;
  verbose: boolean;
}

export function parseArgs(): CliArgs {
  const argv = yargs(hideBin(process.argv))
    .option('domain', {
      type: 'array',
      string: true,
      description: 'Domain(s) to download from Wayback Machine',
    })
    .option('all', {
      type: 'boolean',
      default: false,
      description: 'Process all domains present in cdx_file table',
    })
    .option('output', {
      type: 'string',
      description: 'Output folder location',
      default: './output',
    })
    .option('db', {
      type: 'string',
      description: 'Path to SQLite database file',
      default: './wayback.db',
    })
    .option('proxy-file', {
      type: 'string',
      description: 'Text file with one proxy IP per line',
    })
    .option('max-req-per-second', {
      type: 'number',
      description: 'Max requests per second per proxy',
    })
    .option('max-req-per-minute', {
      type: 'number',
      description: 'Max requests per minute per proxy',
    })
    .option('concurrency', {
      type: 'number',
      description: 'Max concurrent requests',
      default: 5,
    })
    .option('retry-errors', {
      type: 'boolean',
      default: false,
      description:
        'Retry non-successful entries for the given domains instead of fetching new CDX',
    })
    .option('skip-error', {
      type: 'array',
      string: true,
      description: 'Error code(s) to treat as success when downloading',
    })
    .option('skip-error-message', {
      type: 'array',
      string: true,
      description:
        'Error message substring(s) to treat as success when downloading',
    })
    .option('dry-run', {
      type: 'boolean',
      default: false,
      description:
        'Show a summary of what would be downloaded without actually downloading',
    })
    .option('v', {
      alias: 'verbose',
      type: 'boolean',
      default: false,
      description: 'Show individual entries in the dry-run summary',
    })
    .check((args) => {
      const domains = (args['domain'] as string[] | undefined) ?? [];
      if (args['all'] && domains.length > 0) {
        throw new Error('--all and --domain are mutually exclusive');
      }
      if (!args['all'] && domains.length === 0) {
        throw new Error('Either --domain or --all must be provided');
      }
      const skipErrors = (args['skip-error'] as string[] | undefined) ?? [];
      const skipErrorMessages =
        (args['skip-error-message'] as string[] | undefined) ?? [];
      if (
        args['max-req-per-second'] !== undefined &&
        args['max-req-per-minute'] !== undefined
      ) {
        throw new Error(
          '--max-req-per-second and --max-req-per-minute are mutually exclusive; provide only one',
        );
      }
      if (
        !args['dry-run'] &&
        args['max-req-per-second'] === undefined &&
        args['max-req-per-minute'] === undefined
      ) {
        throw new Error(
          'Either --max-req-per-second or --max-req-per-minute must be provided',
        );
      }
      return true;
    })
    .parseSync();

  const domain = (argv['domain'] as string[] | undefined) ?? [];
  const skipErrors = (argv['skip-error'] as string[] | undefined) ?? [];
  const skipErrorMessages =
    (argv['skip-error-message'] as string[] | undefined) ?? [];

  const maxReqPerPeriod =
    argv['max-req-per-second'] !== undefined
      ? (argv['max-req-per-second'] as number)
      : argv['max-req-per-minute'] !== undefined
        ? (argv['max-req-per-minute'] as number)
        : undefined;

  const periodMs = argv['max-req-per-minute'] !== undefined ? 60_000 : 1_000;

  return {
    domain,
    all: argv.all as boolean,
    output: path.resolve(argv.output as string),
    db: path.resolve(argv.db as string),
    proxyFile: argv['proxy-file'] as string | undefined,
    maxReqPerPeriod,
    periodMs: maxReqPerPeriod !== undefined ? periodMs : undefined,
    concurrency: argv.concurrency as number,
    retryErrors: argv['retry-errors'] as boolean,
    skipErrors,
    skipErrorMessages,
    dryRun: argv['dry-run'] as boolean,
    verbose: argv.v as boolean,
  };
}

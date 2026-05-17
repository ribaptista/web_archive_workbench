import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'path';
import {
  DEFAULT_CDX_BASE_URL,
  DEFAULT_CDX_STRATEGY,
  DEFAULT_REPLAY_BASE_URL,
  type CdxServer,
} from '../cdx/sync';
import { type FetchPendingOptions } from '../cdx/repository';

export type DownloadOptions = {
  dataFolder: string;
  proxyFile: string | undefined;
  maxReqPerPeriod: number;
  periodMs: number;
  concurrency: number;
};

export interface CliArgs {
  domain: string[];
  all: boolean;
  dataFolder: string;
  cdxPageSize: number;
  skipCdxSync: boolean;
  dryRun: boolean;
  verbose: boolean;
  cdxServer: CdxServer;
  fetchPendingOptions: FetchPendingOptions;
  downloadOptions: DownloadOptions;
}

const DEFAULT_CDX_PAGE_SIZE = 128;
const ONE_SECOND = 1_000;
const ONE_MINUTE_IN_MILLIS = 60 * ONE_SECOND;

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
    .option('data-folder', {
      alias: 'b',
      type: 'string',
      description:
        'Data folder for storing the archive database and downloaded assets',
      demandOption: true,
    })
    .option('cdx-page-size', {
      type: 'number',
      description: 'CDX API page size (env: CDX_PAGE_SIZE)',
      default: DEFAULT_CDX_PAGE_SIZE,
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
    .option('skip-cdx-sync', {
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
    .option('cdx-base-url', {
      type: 'string',
      description: 'Base URL for CDX API',
      default: DEFAULT_CDX_BASE_URL,
    })
    .option('cdx-strategy', {
      type: 'string',
      choices: ['json_wayback', 'json_pywb'] as const,
      description:
        'CDX fetch strategy: json_wayback (Wayback resumeKey pagination) or json_pywb (single-page jsonlines)',
      default: DEFAULT_CDX_STRATEGY,
    })
    .option('replay-base-url', {
      type: 'string',
      description: 'Base URL for replaying archived resources',
      default: DEFAULT_REPLAY_BASE_URL,
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
      const cdxPageSize = args['cdx-page-size'];
      if (
        typeof cdxPageSize !== 'number' ||
        !Number.isInteger(cdxPageSize) ||
        cdxPageSize <= 0
      ) {
        throw new Error('--cdx-page-size must be a positive integer');
      }
      return true;
    })
    .parseSync();

  const domain = (argv['domain'] as string[] | undefined) ?? [];
  const skipErrors = (argv['skip-error'] as string[] | undefined) ?? [];
  const skipErrorMessages =
    (argv['skip-error-message'] as string[] | undefined) ?? [];

  const periodMs =
    argv['max-req-per-minute'] !== undefined
      ? ONE_MINUTE_IN_MILLIS
      : ONE_SECOND;

  const maxReqPerPeriod =
    argv['max-req-per-second'] !== undefined
      ? (argv['max-req-per-second'] as number)
      : argv['max-req-per-minute'] !== undefined
        ? (argv['max-req-per-minute'] as number)
        : Math.ceil(periodMs / 1000); // Default to 1 req per second if not provided

  const dataFolder = path.resolve(argv['data-folder'] as string);

  return {
    domain,
    all: argv.all as boolean,
    dataFolder,
    cdxPageSize: argv['cdx-page-size'] as number,
    skipCdxSync: argv['skip-cdx-sync'] as boolean,
    dryRun: argv['dry-run'] as boolean,
    verbose: argv.v as boolean,
    cdxServer: {
      baseUrl: argv['cdx-base-url'] as string,
      strategy: argv['cdx-strategy'] as 'json_wayback' | 'json_pywb',
      replayBaseUrl: argv['replay-base-url'] as string,
    },
    fetchPendingOptions: {
      skipErrors,
      skipErrorMessages,
    },
    downloadOptions: {
      dataFolder,
      proxyFile: argv['proxy-file'] as string | undefined,
      maxReqPerPeriod,
      periodMs,
      concurrency: argv.concurrency as number,
    },
  };
}

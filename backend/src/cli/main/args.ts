import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'path';
import {
  DEFAULT_CDX_BASE_URL,
  DEFAULT_CDX_STRATEGY,
  DEFAULT_REPLAY_BASE_URL,
  SUPPORTED_SYNC_STRATEGIES,
  type CdxServer,
  type CdxQueryFilter,
  type SupportedSyncStrategy,
} from '../../cdx/sync';
import type { LimiterOptions } from '../../http/agents';
import { type FetchPendingOptions } from '../../cdx/repository';

export type DownloadOptions = {
  dataFolder: string;
  proxyFile: string | undefined;
  limiterOptions: LimiterOptions;
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
  cdxQueryFilter: CdxQueryFilter;
  fetchPendingOptions: FetchPendingOptions;
  downloadOptions: DownloadOptions;
}

const DEFAULT_CDX_PAGE_SIZE = 128;
const ONE_SECOND = 1_000;
const ONE_MINUTE_IN_MILLIS = 60 * ONE_SECOND;

function validateDomainFilter(all: boolean, domains: string[]): void {
  if (all && domains.length > 0) {
    throw new Error('--all and --domain are mutually exclusive');
  }
  if (!all && domains.length === 0) {
    throw new Error('Either --domain or --all must be provided');
  }
}

function validateCdxDateTimeRangeFilter(
  cdxFrom: string | undefined,
  cdxTo: string | undefined,
  skipCdxSync: boolean,
): void {
  if ((cdxFrom !== undefined || cdxTo !== undefined) && skipCdxSync) {
    throw new Error(
      '--cdx-from / --cdx-to cannot be used together with --skip-cdx-sync',
    );
  }
  if (cdxFrom !== undefined && cdxTo !== undefined && cdxFrom >= cdxTo) {
    throw new Error('--cdx-from must be lower than --cdx-to');
  }
}

function validateRateLimit(
  dryRun: boolean,
  maxReqPerSecond: number | undefined,
  maxReqPerMinute: number | undefined,
): void {
  if (maxReqPerSecond !== undefined && maxReqPerMinute !== undefined) {
    throw new Error(
      '--max-req-per-second and --max-req-per-minute are mutually exclusive; provide only one',
    );
  }
  if (
    !dryRun &&
    maxReqPerSecond === undefined &&
    maxReqPerMinute === undefined
  ) {
    throw new Error(
      'Either --max-req-per-second or --max-req-per-minute must be provided',
    );
  }
}

export function parseArgs(): CliArgs {
  const argv = yargs(hideBin(process.argv))
    .option('domain', {
      type: 'array',
      string: true,
      description: 'Domain(s) to download from archive server',
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
      coerce: (v: number) => {
        if (!Number.isInteger(v) || v <= 0)
          throw new Error('--cdx-page-size must be a positive integer');
        return v;
      },
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
      description:
        'Max concurrent downloads globally across the run (not per proxy)',
      default: 5,
    })
    .option('skip-cdx-sync', {
      type: 'boolean',
      default: false,
      description:
        'Retry non-successful entries for the given domains instead of fetching new CDX',
    })
    .option('skip-error-code', {
      type: 'array',
      string: true,
      description: 'Error code(s) to treat as success when downloading',
    })
    .option('skip-error-name', {
      type: 'array',
      string: true,
      description: 'Error name(s) to treat as success when downloading',
    })
    .option('cdx-base-url', {
      type: 'string',
      description: 'Base URL for CDX API',
      default: DEFAULT_CDX_BASE_URL,
    })
    .option('cdx-strategy', {
      type: 'string',
      choices: SUPPORTED_SYNC_STRATEGIES,
      description:
        'CDX fetch strategy: json_wayback (Wayback resumeKey pagination) or json_pywb (single-page jsonlines)',
      default: DEFAULT_CDX_STRATEGY,
    })
    .option('replay-base-url', {
      type: 'string',
      description: 'Base URL for replaying archived resources',
      default: DEFAULT_REPLAY_BASE_URL,
    })
    .option('cdx-from', {
      type: 'string',
      description:
        'Lower-bound CDX timestamp (YYYYMMDDhhmmss or any prefix). Only valid without --skip-cdx-sync.',
    })
    .option('cdx-to', {
      type: 'string',
      description:
        'Upper-bound CDX timestamp (YYYYMMDDhhmmss or any prefix). Only valid without --skip-cdx-sync.',
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
      validateDomainFilter(args['all'] as boolean, domains);
      validateRateLimit(
        args['dry-run'] as boolean,
        args['max-req-per-second'] as number | undefined,
        args['max-req-per-minute'] as number | undefined,
      );
      validateCdxDateTimeRangeFilter(
        args['cdx-from'] as string | undefined,
        args['cdx-to'] as string | undefined,
        args['skip-cdx-sync'] as boolean,
      );
      return true;
    })
    .parseSync();

  const domain = (argv['domain'] as string[] | undefined) ?? [];
  const skipErrorsCodes =
    (argv['skip-error-code'] as string[] | undefined) ?? [];
  const skipErrorNames =
    (argv['skip-error-name'] as string[] | undefined) ?? [];

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
      strategy: argv['cdx-strategy'] as SupportedSyncStrategy,
      replayBaseUrl: argv['replay-base-url'] as string,
    },
    cdxQueryFilter: {
      from: argv['cdx-from'] as string | undefined,
      to: argv['cdx-to'] as string | undefined,
    },
    fetchPendingOptions: {
      skipErrorsCodes,
      skipErrorNames,
    },
    downloadOptions: {
      dataFolder,
      proxyFile: argv['proxy-file'] as string | undefined,
      limiterOptions: {
        maxReqPerPeriod,
        periodMs,
      },
      concurrency: argv.concurrency as number,
    },
  };
}

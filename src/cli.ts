import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import path from "path";

export interface CliArgs {
  domains: string[];
  output: string;
  db: string;
  cdxId: string | undefined;
  proxyFile: string | undefined;
  maxReqPerSecond: number;
  maxReqPerMinute: number;
  concurrency: number;
  retryErrors: string[];
}

export function parseArgs(): CliArgs {
  const argv = yargs(hideBin(process.argv))
    .option("domains", {
      type: "array",
      string: true,
      description: "Domain(s) to download from Wayback Machine (repeatable)",
    })
    .option("output", {
      type: "string",
      description: "Output folder location",
      default: "./output",
    })
    .option("db", {
      type: "string",
      description: "Path to SQLite database file",
      default: "./wayback.db",
    })
    .option("cdx-id", {
      type: "string",
      description: "CDX file ID to use for downloading (skips CDX fetch)",
    })
    .option("proxy-file", {
      type: "string",
      description: "Text file with one proxy IP per line",
    })
    .option("max-req-per-second", {
      type: "number",
      description: "Max requests per second per proxy",
      default: 5,
    })
    .option("max-req-per-minute", {
      type: "number",
      description: "Max requests per minute per proxy",
      default: 120,
    })
    .option("concurrency", {
      type: "number",
      description: "Max concurrent requests",
      default: 5,
    })
    .option("retry-errors", {
      type: "array",
      string: true,
      description: "CDX ID(s) to retry (repeatable, or comma-separated)",
    })
    .check((args) => {
      const domains = (args["domains"] as string[] | undefined) ?? [];
      const retryErrors = (args["retry-errors"] as string[] | undefined) ?? [];
      if (retryErrors.length === 0 && !args["cdx-id"] && domains.length === 0) {
        throw new Error("Either --domain, --cdx-id, or --retry-errors must be provided");
      }
      return true;
    })
    .parseSync();

  const domains = (argv["domains"] as string[] | undefined) ?? [];
  const retryErrors = (argv["retry-errors"] as string[] | undefined) ?? [];

  return {
    domains,
    output: path.resolve(argv.output as string),
    db: path.resolve(argv.db as string),
    cdxId: argv["cdx-id"] as string | undefined,
    proxyFile: argv["proxy-file"] as string | undefined,
    maxReqPerSecond: argv["max-req-per-second"] as number,
    maxReqPerMinute: argv["max-req-per-minute"] as number,
    concurrency: argv.concurrency as number,
    retryErrors,
  };
}

import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import type { CdxRepository, ReplayCdxRow } from '../../cdx/repository';
import { normalizeUrl } from '../../http/normalized_url';
import { buildAssetPath } from '../../request/paths';

function lookupCdxRow(
  cdxRepo: CdxRepository,
  original: string,
  reqTimestamp: number,
): ReplayCdxRow | undefined {
  const primary = cdxRepo.findReplayCdxByOriginal(original, reqTimestamp);
  if (primary) return primary;

  let normalizedOriginal: string;
  try {
    normalizedOriginal = normalizeUrl(original).toString();
  } catch {
    console.error(`[lookup] could not normalize URL for fallback: ${original}`);
    return undefined;
  }

  const fallbackRows = cdxRepo.findReplayCdxByNormalizedUrl(
    normalizedOriginal,
    reqTimestamp,
  );
  const row = fallbackRows[0];
  if (row) {
    if (
      fallbackRows.length > 1 &&
      Math.abs(fallbackRows[1].timestamp - reqTimestamp) ===
        Math.abs(row.timestamp - reqTimestamp)
    ) {
      console.warn(
        `[lookup] ambiguous fallback match for normalized_url=${normalizedOriginal}: candidates ${row.terminal_original}@${row.timestamp} and ${fallbackRows[1].terminal_original}@${fallbackRows[1].timestamp} are equidistant from ${reqTimestamp}`,
      );
    }
    console.error(
      `[lookup] fallback match: ${original} → original=${row.terminal_original}`,
    );
    return row;
  }

  console.error(
    `[lookup] no fallback match for normalized_url=${normalizedOriginal}`,
  );
  return undefined;
}

export function registerReplayRoutes(
  fastify: FastifyInstance,
  cdxRepo: CdxRepository,
  baseFolder: string,
): void {
  fastify.get<{ Params: { ts: string; '*': string } }>(
    '/:ts/*',
    async (request, reply) => {
      const { ts: reqTimestamp } = request.params;
      const tsIndex = request.url.indexOf(reqTimestamp);
      const prefix = request.url.substring(
        0,
        tsIndex + reqTimestamp.length + 1,
      ); // prefix + ts + /
      if (!request.url.startsWith(prefix)) {
        console.error(
          `[replay] Unexpected prefix in request URL: ${request.url} does not start with ${prefix}`,
        );
      }
      const original = request.url.substring(prefix.length);

      const row = lookupCdxRow(cdxRepo, original, Number(reqTimestamp));

      if (!row) {
        console.error(`[replay] 404 no cdx entry: original=${original}`);
        return reply.code(404).send('Not found');
      }

      if (
        String(row.timestamp) !== reqTimestamp ||
        row.terminal_original !== original
      ) {
        console.info(
          `[replay] 302 timestamp mismatch: req=${reqTimestamp} found=${row.timestamp} original=${original}`,
        );
        return reply.redirect(
          `/replay/${row.timestamp}/${row.terminal_original}`,
          302,
        );
      }

      if (row.location_original !== null && row.location_timestamp !== null) {
        console.info(
          `[replay] 302 redirect: ${original} → ${row.location_original} @ ${row.location_timestamp}`,
        );
        return reply.redirect(
          `/replay/${row.location_timestamp}/${row.location_original}`,
          302,
        );
      }

      const filePath = buildAssetPath(baseFolder, row.body_digest);

      let data: Buffer;
      try {
        data = fs.readFileSync(filePath);
      } catch (error) {
        console.error(`[replay] 500 could not read file: ${filePath}`, error);
        return reply.code(500).send('Could not retrieve asset');
      }

      if (row.remote_live_replay_url) {
        void reply.header(
          'x-remote-live-replay-url',
          row.remote_live_replay_url,
        );
      }
      return reply.type(row.mimetype).send(data);
    },
  );
}

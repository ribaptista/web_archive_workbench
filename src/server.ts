import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { openDatabase } from './db';
import { nestedIdPath } from './id-path';

const PORT = 3000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type VersionRow = {
  timestamp: number;
  original: string;
  has_success: number;
  has_attempt: number;
  error_code: string | null;
};

function appendVersionOverlay(
  html: Buffer,
  versions: VersionRow[],
  currentTimestamp: number,
  url: string,
): Buffer {
  const items = versions
    .map(({ timestamp, original, has_success, has_attempt, error_code }) => {
      const href = `http://localhost:3000/replay/${timestamp}/${escapeHtml(original)}`;
      const isCurrent = timestamp === currentTimestamp;
      let tag = '';
      if (has_attempt === 0) {
        tag =
          '<span style="all:unset;display:inline;font-family:monospace;font-size:10px;line-height:1.4;color:#aaa;margin-right:4px;">[PENDING]</span>';
      } else if (has_success === 0) {
        const label = error_code ? `ERROR:${error_code}` : 'ERROR';
        tag = `<span style="all:unset;display:inline;font-family:monospace;font-size:10px;line-height:1.4;color:#aaa;margin-right:4px;">[${escapeHtml(label)}]</span>`;
      }
      const color = isCurrent ? 'color:#fff;' : 'color:#aaa;';
      const weight = isCurrent ? 'font-weight:bold;' : '';
      return `<li style="all:unset;display:block;margin-bottom:4px;"><a href="${href}" style="all:unset;display:block;font-family:monospace;font-size:12px;line-height:1.4;text-decoration:none;cursor:pointer;${color}${weight}">${tag}${timestamp}</a></li>`;
    })
    .join('');
  const overlay = `
<div id="__wayback_versions__" style="all:initial;display:block;position:fixed;top:0;right:0;height:100vh;width:180px;overflow-y:auto;background:rgba(0,0,0,0.85);color:#fff;font-family:monospace;font-size:12px;line-height:1.4;z-index:2147483647;padding:8px;box-sizing:border-box;">
  <div style="all:unset;display:block;font-family:monospace;font-size:12px;line-height:1.4;color:#fff;font-weight:bold;margin-bottom:8px;border-bottom:1px solid #555;padding-bottom:4px;">Versions (${versions.length})</div>
  <ul style="all:unset;display:block;list-style:none;margin:0;padding:0;">${items}</ul>
  <div style="all:unset;display:block;margin-top:8px;border-top:1px solid #555;padding-top:6px;"><a href="http://localhost:5050/resources?url=${encodeURIComponent(url)}" target="_blank" style="all:unset;display:inline;font-family:monospace;font-size:11px;line-height:1.4;color:#aaa;text-decoration:none;cursor:pointer;">show in tree</a></div>
</div>`;
  return Buffer.concat([html, Buffer.from(overlay, 'utf8')]);
}

function main() {
  const argv = yargs(hideBin(process.argv))
    .option('db', {
      alias: 'd',
      type: 'string',
      description: 'Path to the SQLite database',
      demandOption: true,
    })
    .option('base-folder', {
      alias: 'b',
      type: 'string',
      description: 'Base folder containing domain asset directories',
      demandOption: true,
    })
    .parseSync();

  const dbPath = argv.db;
  const baseFolder = argv['base-folder'];

  const db = openDatabase(dbPath);

  type CdxRow = {
    timestamp: number;
    mimetype: string;
    body_digest: string;
    domain: string;
    terminal_original: string;
    location_original: string | null;
    location_timestamp: number | null;
  };

  const stmtByOriginal = db.prepare<[string, number], CdxRow>(`
    SELECT rv.timestamp, r.mimetype, r.body_digest, cf.domain, rv.url AS terminal_original,
           r.location_original, r.location_timestamp
    FROM resource_version rv
    JOIN request r ON r.id = rv.successful_request_id
    JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
    JOIN cdx_file cf ON cf.id = rvs.cdx_id
    WHERE rv.url = ?
      AND r.body_digest IS NOT NULL
    ORDER BY ABS(rv.timestamp - ?)
    LIMIT 1
  `);

  const stmtByPathAndDomain = db.prepare<[string, string, number], CdxRow>(`
    SELECT rv.timestamp, r.mimetype, r.body_digest, cf.domain, rv.url AS terminal_original,
           r.location_original, r.location_timestamp
    FROM resource_version rv
    JOIN request r ON r.id = rv.successful_request_id
    JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
    JOIN cdx_file cf ON cf.id = rvs.cdx_id
    JOIN cdx_entry ce ON ce.original = rv.url AND ce.timestamp = rv.timestamp AND ce.cdx_id = rvs.cdx_id
    WHERE ce.parsed_path_and_query = ?
      AND cf.domain = ?
      AND r.body_digest IS NOT NULL
    ORDER BY ABS(rv.timestamp - ?)
    LIMIT 1
  `);

  const stmtVersions = db.prepare<[string, string], VersionRow>(`
    SELECT rv.timestamp, rv.url AS original,
      CASE WHEN rv.successful_request_id IS NOT NULL THEN 1 ELSE 0 END AS has_success,
      EXISTS (
        SELECT 1 FROM request r
        WHERE r.resource_version_url = rv.url
          AND r.resource_version_timestamp = rv.timestamp
      ) AS has_attempt,
      (
        -- TODO a request may have multiple errors, but just take one for display purposes
        SELECT re.error_code
        FROM request r
        JOIN request_errors re ON re.request_id = r.id
        WHERE r.resource_version_url = rv.url
          AND r.resource_version_timestamp = rv.timestamp
        ORDER BY r.created_at DESC, re.id ASC
        LIMIT 1
      ) AS error_code
    FROM resource_version rv
    JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
    JOIN cdx_file cf ON cf.id = rvs.cdx_id
    WHERE rv.url = ?
      AND cf.domain = ?
    GROUP BY rv.url, rv.timestamp
    ORDER BY rv.timestamp DESC
  `);

  function lookupCdxRow(
    original: string,
    reqTimestamp: number,
  ): CdxRow | undefined {
    const primary = stmtByOriginal.get(original, reqTimestamp);
    if (primary) return primary;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(original);
    } catch {
      console.error(`[lookup] could not parse URL for fallback: ${original}`);
      return undefined;
    }

    const pathAndQuery = parsedUrl.pathname + parsedUrl.search;
    const hostParts = parsedUrl.hostname.split('.');

    for (let start = 0; hostParts.length - start >= 2; start++) {
      const domain = hostParts.slice(start).join('.');
      const row = stmtByPathAndDomain.get(pathAndQuery, domain, reqTimestamp);
      if (row) {
        console.error(
          `[lookup] fallback match: ${original} → original=${row.terminal_original}`,
        );
        return row;
      }
    }

    console.error(
      `[lookup] no fallback match for path_and_query=${pathAndQuery} (tried ${hostParts.length - 1} domain(s))`,
    );
    return undefined;
  }

  const replayRouteRe = /^\/replay\/(from_referer|\d+)\/(.+)$/s;
  const refererReplayRe = /^http:\/\/localhost:3000\/replay\/(\d+)\/(.+)$/s;

  function handleReplayFromReferer(
    original: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const referer = req.headers['referer'];
    if (!referer) {
      console.error('[replay] 404 from_referer: no Referer header');
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const refMatch = referer.match(refererReplayRe);
    if (!refMatch) {
      console.error(
        `[replay] 404 from_referer: ${req.url} Referer does not match replay pattern: ${referer}`,
      );
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const timestamp = refMatch[1];
    const redirectUrl = `http://localhost:${PORT}/replay/${timestamp}/${original}`;
    console.error(`[replay] 302 from_referer: ${original} → ${redirectUrl}`);
    res.writeHead(302, { Location: redirectUrl });
    res.end();
  }

  function handleLocalhostRewrite(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): boolean {
    const referer = req.headers['referer'];
    const refMatch = referer?.match(refererReplayRe);
    if (refMatch) {
      const timestamp = refMatch[1];
      const replayedUrl = refMatch[2];
      const replayedOrigin = new URL(replayedUrl).origin;
      const pathAndQuery = req.url;
      const rewritten = replayedOrigin + pathAndQuery;
      const redirectUrl = `http://localhost:${PORT}/replay/${timestamp}/${rewritten}`;
      console.error(
        `[replay] 302 localhost rewrite: ${req.url} → ${redirectUrl}`,
      );
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      return true;
    }

    console.error(
      `[replay] localhost original but no valid referer: ${req.url} referer=${req.headers['referer']}`,
    );
    return false;
  }

  function handleReplay(
    timestampOrFromRefererFlag: string,
    original: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    if (timestampOrFromRefererFlag === 'from_referer') {
      handleReplayFromReferer(original, req, res);
      return;
    }

    const reqTimestamp = timestampOrFromRefererFlag;

    const row = lookupCdxRow(original, Number(reqTimestamp));

    if (!row) {
      console.error(`[replay] 404 no cdx entry: original=${original}`);
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (
      String(row.timestamp) !== reqTimestamp ||
      row.terminal_original !== original
    ) {
      console.error(
        `[replay] 302 timestamp mismatch: req=${reqTimestamp} found=${row.timestamp} original=${original}`,
      );
      res.writeHead(302, {
        Location: `/replay/${row.timestamp}/${row.terminal_original}`,
      });
      res.end();
      return;
    }

    if (row.location_original !== null && row.location_timestamp !== null) {
      console.error(
        `[replay] 302 redirect: ${original} → ${row.location_original} @ ${row.location_timestamp}`,
      );
      res.writeHead(302, {
        Location: `/replay/${row.location_timestamp}/${row.location_original}`,
      });
      res.end();
      return;
    }

    const filePath = nestedIdPath(
      path.join(baseFolder, 'assets'),
      row.body_digest,
      2,
    );

    let data: Buffer;
    try {
      data = fs.readFileSync(filePath);
    } catch {
      console.error(`[replay] 404 file not found: ${filePath}`);
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (row.mimetype !== null && row.mimetype.startsWith('text/html')) {
      const versions = stmtVersions.all(original, row.domain);
      console.log(
        '------------------',
        original,
        versions.length,
        'versions found',
      );
      data = appendVersionOverlay(data, versions, row.timestamp, original);
    }
    // console.log(`[replay] 200 ${original} (${filePath})`);
    res.writeHead(200, { 'Content-Type': row.mimetype });
    res.end(data);
  }

  http
    .createServer((req, res) => {
      res.setHeader('Referrer-Policy', 'unsafe-url');
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

      const replayMatch = req.url?.match(replayRouteRe);
      if (replayMatch) {
        handleReplay(replayMatch[1], replayMatch[2], req, res);
        return;
      }

      if (!handleLocalhostRewrite(req, res)) {
        console.error(`[server] 404 unhandled path: ${req.url}`);
        res.writeHead(404);
        res.end('Not found');
      }
    })
    .listen(PORT, () => {
      console.error(`Listening on http://localhost:${PORT}`);
    });
}

main();
